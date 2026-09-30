# 测试记录

测试日期：2026-09-30  
环境：Windows、Node.js v22.14.0、Docker CLI 29.7.2、Compose v5.5.0。

## 自动化结果

执行 `npm test`，共 25 项，25 项通过、0 项失败。覆盖 API 功能 9 项以上、Web/配置 9 项、安全边界 6 项以上及数据库关闭重开持久化。

## 统计对照（本地演示模式）

| 短码 | 真实 GET 次数 | 查询结果 |
|---|---:|---:|
| `go-target` | 2 | 2 |
| `keep-data` | 1 | 重开后仍为 1 |

## 容器验证范围

`docker compose config --quiet` 可完成配置解析。但测试日 Docker Desktop Linux Engine 未运行，`docker version` 报命名管道不存在，因此没有伪造 `compose up`、三容器健康状态或卷重建实测结果。Compose 已按任务书固定镜像、服务名、健康依赖和命名卷编写；待 Docker Desktop 可用后按 README 的验收命令复核。

## 手工验收清单

1. 创建三条短链并分别真实 GET 1、2、3 次。
2. 列表访问数应分别为 1、2、3；HEAD 不作为计数口径。
3. `docker compose down` 后重新 `up -d`，短码和访问数不变。
4. 浏览器 Network 检查：请求中不出现 `X-Api-Key`。
5. 执行备份，创建新数据，再恢复并核对原短码。

