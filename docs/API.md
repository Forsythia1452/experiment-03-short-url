# 接口与错误码

浏览器只访问 Web 后端的 `/api`，`X-Api-Key` 由后端注入，绝不返回给浏览器。

| 方法 | 路径 | 用途 | 成功状态 |
|---|---|---|---|
| GET | `/healthz` | Web 与上游健康检查 | 200 |
| GET | `/api/short-urls` | 查询短链列表 | 200 |
| POST | `/api/short-urls` | 创建短链 | 201 |
| GET | `/api/short-urls/{code}/visits` | 查询访问统计 | 200 |
| GET | `/s/{code}` | 仅本地演示模式：302 跳转 | 302 |

POST 示例：

```json
{
  "longUrl": "https://example.com/article",
  "customSlug": "my-article",
  "validUntil": "2026-12-31T15:59:59.000Z"
}
```

错误码：400 输入错误、404 未知短码、409 短码冲突、410 已过期、413 请求过大、429 创建频率超限、502/504 上游失败。

