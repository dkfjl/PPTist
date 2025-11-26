# PPTist AI 后端服务

这是为PPTist项目搭建的AI后端服务，提供完整的AI生成PPT功能。

## 功能特性

- ✅ 支持多种AI模型（智谱GLM、豆包、OpenAI）
- ✅ 流式响应，实时生成内容
- ✅ 完整的PPT生成接口
- ✅ AI文字处理（改写/扩写/缩写）
- ✅ 图片搜索接口（模拟实现）
- ✅ 健康检查和监控

## 快速开始

### 1. 安装依赖

```bash
cd backend
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并填入你的API密钥：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
# 智谱AI API配置（推荐）
ZHIPU_API_KEY=your_zhipu_api_key_here

# 服务器配置
PORT=3001
NODE_ENV=development
```

### 3. 启动服务

```bash
# 开发模式（热重载）
npm run dev

# 生产模式
npm start
```

服务启动后访问：
- 服务地址：http://localhost:3001
- 健康检查：http://localhost:3001/health

## API接口文档

### 1. 生成PPT大纲
```
POST /tools/aippt_outline

Request Body:
{
  "content": "PPT主题",
  "language": "中文",
  "model": "GLM-4.5-Flash"
}

Response: 流式JSON数据
```

### 2. 生成完整PPT
```
POST /tools/aippt

Request Body:
{
  "content": "PPT大纲内容",
  "language": "中文", 
  "style": "通用",
  "model": "GLM-4.5-Flash"
}

Response: 流式JSON数据
```

### 3. AI文字处理
```
POST /tools/ai_writing

Request Body:
{
  "content": "原文内容",
  "command": "改写",  // 改写/扩写/缩写
  "model": "ark-doubao-seed-1.6-flash"  // 可选
}

Response: 流式文本数据
```

### 4. 图片搜索
```
POST /tools/img_search

Request Body:
{
  "query": "搜索关键词",
  "per_page": 20
}

Response: JSON数据
```

## 支持的AI模型

| 模型名称 | 提供商 | 说明 |
|---------|--------|------|
| GLM-4.5-Flash | 智谱AI | 推荐，速度快，成本低 |
| ark-doubao-seed-1.6-flash | 豆包 | 字节跳动模型 |
| gpt-3.5-turbo | OpenAI | 经典模型 |
| gpt-4 | OpenAI | 最强模型 |

## 获取API密钥

### 智谱AI（推荐）
1. 访问：https://open.bigmodel.cn/
2. 注册并实名认证
3. 在控制台获取API Key
4. 充值（价格便宜）

### 豆包AI
1. 访问：https://www.volcengine.com/
2. 注册火山方舟账号
3. 创建豆包模型实例
4. 获取API Key

### OpenAI
1. 访问：https://platform.openai.com/
2. 注册账号并充值
3. 获取API Key

## 前端配置

确保PPTist前端项目配置正确指向本地后端：

```typescript
// src/services/index.ts
export const SERVER_URL = (import.meta.env.MODE === 'development') ? 'http://localhost:3001' : 'https://server.pptist.cn'
```

## Docker部署

创建 `Dockerfile`：

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3001

CMD ["npm", "start"]
```

创建 `docker-compose.yml`：

```yaml
version: '3.8'

services:
  pptist-backend:
    build: .
    ports:
      - "3001:3001"
    env_file:
      - .env
    restart: unless-stopped
```

部署：

```bash
docker-compose up -d
```

## 生产环境部署

### 使用PM2管理进程

```bash
# 安装PM2
npm install -g pm2

# 启动服务
pm2 start server.js --name "pptist-backend"

# 查看状态
pm2 status

# 查看日志
pm2 logs pptist-backend
```

### 使用Nginx反向代理

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 故障排除

### 1. API密钥错误
- 检查 `.env` 文件中的API密钥是否正确
- 确认API密钥有足够的余额
- 检查网络连接

### 2. 模型调用失败
- 查看服务器日志中的具体错误信息
- 确认模型名称拼写正确
- 检查API请求格式

### 3. 流式响应问题
- 确认前端正确处理流式数据
- 检查CORS配置
- 验证响应头设置

### 4. 连接问题
- 检查端口是否被占用
- 确认防火墙设置
- 验证网络代理配置

## 监控和日志

服务提供以下监控端点：

- `GET /health` - 健康检查
- 控制台输出详细日志
- 错误信息统一记录

## 开发建议

1. **先测试单个接口**：使用curl或Postman测试
2. **查看流式响应**：确认数据格式正确
3. **集成前端测试**：完整的端到端测试
4. **监控API使用量**：避免超出配额

## 许可证

MIT License - 可自由使用和修改
