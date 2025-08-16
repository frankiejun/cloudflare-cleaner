/**
 * Cloudflare 清理工具
 * 定期清理 Cloudflare Pages 的历史部署版本
 */

class CloudflareAPI {
  constructor(env) {
    this.apiToken = env.CF_API_TOKEN;
    this.accountId = env.CF_ACCOUNT_ID;
    this.email = env.CF_EMAIL; // 全局 Token 需要的邮箱
    this.baseUrl = 'https://api.cloudflare.com/client/v4';
    this.isGlobalToken = this.apiToken && this.apiToken.length === 37; // 全局 Token 长度为 37
  }

  async makeRequest(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    
    // 构建请求头
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // 根据 Token 类型设置认证头
    if (this.isGlobalToken) {
      if (!this.email) {
        throw new Error('使用全局 API Token 时需要设置 CF_EMAIL 环境变量');
      }
      headers['X-Auth-Key'] = this.apiToken;
      headers['X-Auth-Email'] = this.email;
    } else {
      headers['Authorization'] = `Bearer ${this.apiToken}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      let errorDetail = `${response.status} ${response.statusText}`;
      try {
        const errorBody = await response.text();
        if (errorBody) {
          const errorData = JSON.parse(errorBody);
          if (errorData.errors && errorData.errors.length > 0) {
            errorDetail += `: ${errorData.errors.map(e => e.message).join(', ')}`;
          }
        }
      } catch (e) {
        // 如果解析错误响应失败，使用原始错误信息
      }
      throw new Error(`API 请求失败 [${endpoint}]: ${errorDetail}`);
    }

    return response.json();
  }

  // 获取所有 Pages 项目
  async getPagesProjects() {
    const response = await this.makeRequest(`/accounts/${this.accountId}/pages/projects`);
    
    if (!response.success) {
      throw new Error(`获取 Pages 项目失败: ${response.errors.map(e => e.message).join(', ')}`);
    }
    
    return response.result;
  }

  // 获取特定项目的部署历史
  async getPageDeployments(projectName) {
    // Cloudflare Pages API 的分页参数可能需要不同的格式
    const response = await this.makeRequest(
      `/accounts/${this.accountId}/pages/projects/${projectName}/deployments`
    );
    
    if (!response.success) {
      throw new Error(`获取项目 ${projectName} 部署历史失败: ${response.errors.map(e => e.message).join(', ')}`);
    }
    
    return response.result;
  }

  // 删除特定的部署
  async deletePageDeployment(projectName, deploymentId) {
    const response = await this.makeRequest(
      `/accounts/${this.accountId}/pages/projects/${projectName}/deployments/${deploymentId}`,
      { method: 'DELETE' }
    );
    
    if (!response.success) {
      throw new Error(`删除部署 ${deploymentId} 失败: ${response.errors.map(e => e.message).join(', ')}`);
    }
  }

  // Workers 历史版本目前无官方删除 API；相关逻辑已移除
}

class CloudflareCleaner {
  constructor(env) {
    this.api = new CloudflareAPI(env);
    this.keepVersions = parseInt(env.KEEP_VERSIONS) || 5;
  }

  // 验证 API Token 权限
  async validatePermissions() {
    const result = {
      valid: true,
      permissions: {
        pages: false,
        workers: false,
        account: false
      },
      errors: []
    };

    try {
      // 测试 Pages 权限
      await this.api.getPagesProjects();
      result.permissions.pages = true;
      result.permissions.account = true; // 如果能访问 Pages，说明账户权限正常
    } catch (error) {
      result.permissions.pages = false;
      result.errors.push(`Pages 权限验证失败: ${error.message}`);
    }

    // Workers 版本删除不再执行，这里仅返回 Pages 权限结果
    result.permissions.workers = false;
    result.valid = result.permissions.pages;
    
    return result;
  }

  // 清理 Pages 部署历史
  async cleanupPagesDeployments() {
    const result = {
      projects_checked: 0,
      deployments_deleted: 0,
      errors: [],
    };

    try {
      const projects = await this.api.getPagesProjects();
      result.projects_checked = projects.length;

      for (const project of projects) {
        try {
          const deploymentsResponse = await this.api.getPageDeployments(project.name);
          
          // 确保 deployments 是数组
          let deployments = [];
          if (Array.isArray(deploymentsResponse)) {
            deployments = deploymentsResponse;
          } else if (deploymentsResponse && Array.isArray(deploymentsResponse.result)) {
            deployments = deploymentsResponse.result;
          } else {
            console.warn(`项目 ${project.name} 的部署数据格式不正确:`, deploymentsResponse);
            continue;
          }
          
          console.log(`项目 ${project.name} 有 ${deployments.length} 个部署`);
          
          if (deployments.length === 0) {
            console.log(`项目 ${project.name} 没有部署历史，跳过`);
            continue;
          }
          
          // 按创建时间排序，保留最新的几个部署
          const sortedDeployments = deployments
            .filter(d => {
              // 检查不同可能的状态字段
              const status = d.status || (d.latest_stage && d.latest_stage.status);
              return status === 'success';
            })
            .sort((a, b) => new Date(b.created_on).getTime() - new Date(a.created_on).getTime());

          console.log(`项目 ${project.name} 有 ${sortedDeployments.length} 个成功的部署`);
          const deploymentsToDelete = sortedDeployments.slice(this.keepVersions);
          console.log(`项目 ${project.name} 需要删除 ${deploymentsToDelete.length} 个部署`);

          for (const deployment of deploymentsToDelete) {
            try {
              await this.api.deletePageDeployment(project.name, deployment.id);
              result.deployments_deleted++;
              console.log(`已删除 Pages 部署: ${project.name}/${deployment.short_id}`);
            } catch (error) {
              const errorMsg = `删除 Pages 部署失败 ${project.name}/${deployment.short_id}: ${error.message}`;
              result.errors.push(errorMsg);
              console.error(errorMsg);
            }
          }
        } catch (error) {
          const errorMsg = `处理项目 ${project.name} 失败: ${error.message}`;
          result.errors.push(errorMsg);
          console.error(errorMsg);
        }
      }
    } catch (error) {
      const errorMsg = `获取 Pages 项目失败: ${error.message}`;
      result.errors.push(errorMsg);
      console.error(errorMsg);
    }

    return result;
  }

  // Workers 版本清理已停用
  async cleanupWorkerScriptVersions() {
    return {
      scripts_checked: 0,
      versions_deleted: 0,
      errors: ['Workers 历史版本不支持通过 API 删除，已跳过'],
    };
  }

  // 执行完整的清理操作
  async cleanup() {
    const startTime = Date.now();
    
    console.log(`开始清理操作，保留最近 ${this.keepVersions} 个版本...`);

    // 先验证权限
    console.log('验证 API Token 权限...');
    const permissionCheck = await this.validatePermissions();
    
    if (!permissionCheck.valid) {
      console.error('权限验证失败:', permissionCheck.errors);
      throw new Error(`API Token 权限不足: ${permissionCheck.errors.join('; ')}`);
    }

    console.log('权限验证通过:', {
      pages: permissionCheck.permissions.pages,
      workers: permissionCheck.permissions.workers
    });

    // 根据权限决定执行哪些清理操作
    const cleanupPromises = [];
    
    if (permissionCheck.permissions.pages) {
      cleanupPromises.push(this.cleanupPagesDeployments());
    } else {
      console.warn('跳过 Pages 清理 - 权限不足');
      cleanupPromises.push(Promise.resolve({
        projects_checked: 0,
        deployments_deleted: 0,
        errors: ['跳过 - API Token 缺少 Pages 权限']
      }));
    }

    if (permissionCheck.permissions.workers) {
      console.log('🔧 开始 Workers 版本清理 (对当前脚本有额外保护)');
      cleanupPromises.push(this.cleanupWorkerScriptVersions());
    } else {
      console.warn('跳过 Workers 清理 - 权限不足');
      cleanupPromises.push(Promise.resolve({
        scripts_checked: 0,
        versions_deleted: 0,
        errors: ['跳过 - API Token 缺少 Workers 权限']
      }));
    }

    const [pagesResult, workersResult] = await Promise.all(cleanupPromises);

    const result = {
      permissions: permissionCheck.permissions,
      pages: pagesResult,
      workers: workersResult,
      total_deleted: pagesResult.deployments_deleted + workersResult.versions_deleted,
      execution_time_ms: Date.now() - startTime,
    };

    console.log(`清理完成！总共删除 ${result.total_deleted} 个版本，耗时 ${result.execution_time_ms}ms`);
    
    return result;
  }
}

export default {
  // 定时触发器处理函数
  async scheduled(controller, env, ctx) {
    console.log('定时清理任务开始执行...', new Date().toISOString());
    
    // 验证必需的环境变量
    if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) {
      console.error('缺少必需的环境变量: CF_API_TOKEN 或 CF_ACCOUNT_ID');
      return;
    }

    try {
      const cleaner = new CloudflareCleaner(env);
      const result = await cleaner.cleanup();
      
      // 记录清理结果
      console.log('清理任务完成:', JSON.stringify(result, null, 2));
      
      // 如果有错误，记录但不抛出异常
      if (result.pages.errors.length > 0 || result.workers.errors.length > 0) {
        console.warn('清理过程中发生了一些错误:', {
          pages_errors: result.pages.errors,
          workers_errors: result.workers.errors,
        });
      }
    } catch (error) {
      console.error('清理任务执行失败:', error);
      throw error; // 重新抛出错误以触发重试机制
    }
  },

  // HTTP 请求处理函数（用于手动触发和状态检查）
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 简单的路由处理
    switch (url.pathname) {
      case '/':
        return new Response(
          JSON.stringify({
            service: 'Cloudflare 清理工具',
            version: '1.0.0',
            description: '定期清理 Cloudflare Pages 的历史部署版本',
            endpoints: {
              '/': '服务信息',
              '/health': '健康检查',
              '/permissions': '检查 API Token 权限',
              '/debug': '调试 API 响应数据',
              '/cleanup': '手动触发清理（POST）',
              '/status': '获取清理状态',
            },
            config: {
              keep_versions: env.KEEP_VERSIONS || '5',
              account_id: env.CF_ACCOUNT_ID || '未配置',
              api_token_configured: !!env.CF_API_TOKEN,
            },
          }, null, 2),
          {
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Access-Control-Allow-Origin': '*',
            },
          }
        );

      case '/health':
        // 健康检查端点
        const healthStatus = {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          environment_check: {
            cf_api_token: !!env.CF_API_TOKEN,
            cf_account_id: !!env.CF_ACCOUNT_ID,
            keep_versions: env.KEEP_VERSIONS || '5',
          },
        };
        
        return new Response(JSON.stringify(healthStatus, null, 2), {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
          },
        });

      case '/permissions':
        // 检查 API Token 权限
        if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) {
          return new Response(
            JSON.stringify({
              error: '缺少必需的环境变量',
              missing: {
                cf_api_token: !env.CF_API_TOKEN,
                cf_account_id: !env.CF_ACCOUNT_ID,
                cf_email: !env.CF_EMAIL,
              },
              provided: {
                cf_api_token_length: env.CF_API_TOKEN ? env.CF_API_TOKEN.length : 0,
                cf_account_id_format: env.CF_ACCOUNT_ID || 'not provided',
                cf_email_provided: !!env.CF_EMAIL,
              }
            }, null, 2),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json; charset=utf-8' },
            }
          );
        }

        try {
          const cleaner = new CloudflareCleaner(env);
          
          // 先显示配置信息
          const configInfo = {
            tokenType: cleaner.api.isGlobalToken ? 'Global Token' : 'Scoped Token',
            tokenLength: env.CF_API_TOKEN ? env.CF_API_TOKEN.length : 0,
            accountId: env.CF_ACCOUNT_ID,
            emailProvided: !!env.CF_EMAIL,
            baseUrl: cleaner.api.baseUrl
          };
          
          console.log('配置信息:', JSON.stringify(configInfo, null, 2));
          
          const permissionCheck = await cleaner.validatePermissions();
          
          return new Response(JSON.stringify({
            timestamp: new Date().toISOString(),
            config: configInfo,
            ...permissionCheck,
            recommendations: permissionCheck.valid ? 
              ['权限验证通过，可以正常使用清理功能'] :
              [
                '请检查 API Token 权限配置',
                '确保 Account ID 正确',
                '如使用全局 Token，确保 CF_EMAIL 正确',
                '参考 README.md 中的权限配置说明'
              ]
          }, null, 2), {
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Access-Control-Allow-Origin': '*',
            },
          });
        } catch (error) {
          console.error('权限检查异常:', error);
          return new Response(
            JSON.stringify({
              error: '权限检查失败',
              message: error.message,
              stack: error.stack,
              timestamp: new Date().toISOString(),
            }, null, 2),
            {
              status: 500,
              headers: { 'Content-Type': 'application/json; charset=utf-8' },
            }
          );
        }

      case '/debug':
        // 调试 API 响应数据
        if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) {
          return new Response(
            JSON.stringify({
              error: '缺少必需的环境变量',
              missing: {
                cf_api_token: !env.CF_API_TOKEN,
                cf_account_id: !env.CF_ACCOUNT_ID,
              },
            }, null, 2),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json; charset=utf-8' },
            }
          );
        }

        try {
          const api = new CloudflareAPI(env);
          
          // 获取 Pages 数据结构（Workers 清理已停用）
          const debugInfo = {
            timestamp: new Date().toISOString(),
            pages: {}
          };

          try {
            const pagesProjects = await api.getPagesProjects();
            debugInfo.pages = {
              count: pagesProjects.length,
              sample: pagesProjects.slice(0, 2), // 只显示前2个
              fields: pagesProjects.length > 0 ? Object.keys(pagesProjects[0]) : []
            };
            
            // 如果有项目，尝试获取第一个项目的部署信息
            if (pagesProjects.length > 0) {
              const firstProject = pagesProjects[0];
              try {
                const deployments = await api.getPageDeployments(firstProject.name);
                debugInfo.pages.firstProjectDeployments = {
                  projectName: firstProject.name,
                  deploymentsType: typeof deployments,
                  deploymentsIsArray: Array.isArray(deployments),
                  deploymentsCount: Array.isArray(deployments) ? deployments.length : 'N/A',
                  sampleDeployment: Array.isArray(deployments) && deployments.length > 0 ? deployments[0] : deployments
                };
              } catch (deploymentError) {
                debugInfo.pages.firstProjectDeployments = {
                  projectName: firstProject.name,
                  error: deploymentError.message
                };
              }
            }
          } catch (error) {
            debugInfo.pages.error = error.message;
          }

          // Workers 相关调试已移除
          
          return new Response(JSON.stringify(debugInfo, null, 2), {
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Access-Control-Allow-Origin': '*',
            },
          });
        } catch (error) {
          return new Response(
            JSON.stringify({
              error: '调试信息获取失败',
              message: error.message,
              timestamp: new Date().toISOString(),
            }, null, 2),
            {
              status: 500,
              headers: { 'Content-Type': 'application/json; charset=utf-8' },
            }
          );
        }

      case '/cleanup':
        // 手动触发清理
        if (request.method !== 'POST') {
          return new Response('Method Not Allowed', { status: 405 });
        }

        // 验证必需的环境变量
        if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) {
          return new Response(
            JSON.stringify({
              error: '缺少必需的环境变量',
              missing: {
                cf_api_token: !env.CF_API_TOKEN,
                cf_account_id: !env.CF_ACCOUNT_ID,
              },
            }, null, 2),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json; charset=utf-8' },
            }
          );
        }

        try {
          console.log('手动触发清理任务...', new Date().toISOString());
          
          const cleaner = new CloudflareCleaner(env);
          const result = await cleaner.cleanup();
          
          return new Response(JSON.stringify(result, null, 2), {
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Access-Control-Allow-Origin': '*',
            },
          });
        } catch (error) {
          console.error('手动清理失败:', error);
          
          return new Response(
            JSON.stringify({
              error: '清理任务执行失败',
              message: error.message,
              timestamp: new Date().toISOString(),
            }, null, 2),
            {
              status: 500,
              headers: { 'Content-Type': 'application/json; charset=utf-8' },
            }
          );
        }

      case '/status':
        // 获取服务状态和配置信息
        const status = {
          service: 'Cloudflare 清理工具',
          status: 'running',
          timestamp: new Date().toISOString(),
          configuration: {
            keep_versions: parseInt(env.KEEP_VERSIONS || '5'),
            account_id: env.CF_ACCOUNT_ID || '未配置',
            api_token_configured: !!env.CF_API_TOKEN,
          },
          next_scheduled_run: '每天凌晨 2:00（UTC）',
          manual_trigger: {
            method: 'POST',
            endpoint: '/cleanup',
            description: '发送 POST 请求到 /cleanup 端点可手动触发清理任务',
          },
        };
        
        return new Response(JSON.stringify(status, null, 2), {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
          },
        });

      default:
        return new Response('Not Found', { status: 404 });
    }
  },
};
