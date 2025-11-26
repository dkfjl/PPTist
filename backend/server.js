const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(cors({
  origin: '*', // 允许所有来源
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // 允许的HTTP方法
  allowedHeaders: ['Content-Type', 'Authorization'], // 允许的请求头
  credentials: true // 允许发送凭据
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 处理预检请求
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.status(200).send();
});

// 智谱AI配置
const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY;
const ZHIPU_BASE_URL = process.env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';

// 豆包AI配置
const DOUBAO_API_KEY = process.env.DOUBAO_API_KEY;
const DOUBAO_BASE_URL = process.env.DOUBAO_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';

// OpenAI配置
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

// AI模型映射
const MODEL_CONFIGS = {
  'GLM-4.5-Flash': {
    provider: 'zhipu',
    model: 'glm-4-flash',
    url: `${ZHIPU_BASE_URL}/chat/completions`
  },
  'GLM-4.6': {
    provider: 'zhipu',
    model: 'glm-4.6',
    url: `${ZHIPU_BASE_URL}/chat/completions`
  },
  'ark-doubao-seed-1.6-flash': {
    provider: 'doubao',
    model: 'doubao-seed-1.6-flash',
    url: `${DOUBAO_BASE_URL}/chat/completions`
  },
  'gemini-3-pro-preview': {
    provider: 'openai',
    model: 'gemini-3-pro-preview',
    url: `${OPENAI_BASE_URL}/chat/completions`
  },
  'gpt-4': {
    provider: 'openai',
    model: 'gpt-4',
    url: `${OPENAI_BASE_URL}/chat/completions`
  }
};

// 通用AI调用函数
async function callAI(model, messages, stream = false) {
  const config = MODEL_CONFIGS[model];
  if (!config) {
    throw new Error(`不支持的模型: ${model}`);
  }

  let requestData;
  const headers = {
    'Content-Type': 'application/json'
  };

  switch (config.provider) {
    case 'zhipu':
      headers['Authorization'] = `Bearer ${ZHIPU_API_KEY}`;
      requestData = {
        model: config.model,
        messages: messages,
        stream: stream,
        temperature: 0.7,
        max_tokens: 4000
      };
      break;
    case 'doubao':
      headers['Authorization'] = `Bearer ${DOUBAO_API_KEY}`;
      requestData = {
        model: config.model,
        messages: messages,
        stream: stream,
        temperature: 0.7,
        max_tokens: 4000
      };
      break;
    case 'openai':
      headers['Authorization'] = `Bearer ${OPENAI_API_KEY}`;
      requestData = {
        model: config.model,
        messages: messages,
        stream: stream,
        temperature: 0.7,
        max_tokens: 4000
      };
      break;
    default:
      throw new Error(`不支持的AI提供商: ${config.provider}`);
  }

  try {
    const response = await axios.post(config.url, requestData, {
      headers,
      responseType: stream ? 'stream' : 'json'
    });
    return response;
  }
  catch (error) {
    console.error('AI API调用失败:', error.response?.data || error.message);
    throw error;
  }
}

// PPT大纲生成接口
app.post('/tools/aippt_outline', async (req, res) => {
  try {
    const { content, language, model } = req.body;
    
    if (!content || !language || !model) {
      return safeJsonResponse(res, { error: '缺少必要参数: content, language, model' }, 400);
    }

    const languageMap = {
      '中文': '请用中文',
      'English': 'Please respond in English',
      '日本語': '日本語で答えてください'
    };

    const prompt = `${languageMap[language] || '请用中文'}为"${content}"生成PPT大纲。

要求：
1. 返回标准的JSON格式，符合PPTist的AIPPT类型定义
2. 包含封面页、目录页、过渡页、内容页、结束页
3. 每个内容页包含2-4个要点
4. 内容要有逻辑性和层次性

JSON格式示例：
[
  {
    "type": "cover",
    "data": {
      "title": "标题",
      "text": "副标题或描述"
    }
  },
  {
    "type": "contents", 
    "data": {
      "items": ["目录项1", "目录项2", "目录项3"]
    }
  }
]`;

    const messages = [
      {
        role: 'user',
        content: prompt
      }
    ];

    const response = await callAI(model, messages, true);

    // 设置流式响应头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    // 流式传输响应
    response.data.pipe(res);

  }
  catch (error) {
    console.error('PPT大纲生成失败:', error);
    
    // 安全地提取错误信息，避免循环引用
    let errorDetails = 'Unknown error';
    if (error.response?.data) {
      errorDetails = error.response.data;
    }
    else if (error.message) {
      errorDetails = error.message;
    }
    else if (typeof error === 'string') {
      errorDetails = error;
    }

    // 检查特定错误类型
    let errorMessage = 'AI服务异常';
    if (error.response?.status === 429) {
      errorMessage = 'AI服务请求频率限制，请稍后重试';
    }
    else if (error.response?.status === 401) {
      errorMessage = 'AI服务认证失败，请检查API密钥';
    }
    else if (error.response?.status >= 500) {
      errorMessage = 'AI服务暂时不可用，请稍后重试';
    }

    safeJsonResponse(res, { 
      error: errorMessage, 
      details: errorDetails,
      status: error.response?.status || 500
    }, 500);
  }
});

// 完整PPT生成接口
app.post('/tools/aippt', async (req, res) => {
  try {
    const { content, language, style, model } = req.body;
    
    if (!content || !language || !style || !model) {
      return safeJsonResponse(res, { error: '缺少必要参数: content, language, style, model' }, 400);
    }

    const languageMap = {
      '中文': '请用中文',
      'English': 'Please respond in English',
      '日本語': '日本語で答えてください'
    };

    const styleMap = {
      '通用': '通用风格',
      '学术风': '学术风格',
      '职场风': '职场商务风格', 
      '教育风': '教育培训风格',
      '营销风': '营销推广风格'
    };

    const prompt = `${languageMap[language] || '请用中文'}根据以下大纲生成完整的PPT数据：

大纲内容：
${content}

要求：
1. 风格：${styleMap[style] || '通用风格'}
2. 返回流式JSON数据，每行一个完整的JSON对象
3. 严格按照PPTist的AIPPT类型定义格式
4. 每个内容项控制在合理字数内
5. 保持内容的连贯性和专业性

请逐个返回PPT页面数据，每个JSON对象一行。`;

    const messages = [
      {
        role: 'user',
        content: prompt
      }
    ];

    const response = await callAI(model, messages, true);

    // 设置流式响应头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    // 流式传输响应
    response.data.pipe(res);

  }
  catch (error) {
    console.error('PPT生成失败:', error);
    
    // 安全地提取错误信息，避免循环引用
    let errorDetails = 'Unknown error';
    if (error.response?.data) {
      errorDetails = error.response.data;
    }
    else if (error.message) {
      errorDetails = error.message;
    }
    else if (typeof error === 'string') {
      errorDetails = error;
    }

    // 检查特定错误类型
    let errorMessage = 'AI服务异常';
    if (error.response?.status === 429) {
      errorMessage = 'AI服务请求频率限制，请稍后重试';
    }
    else if (error.response?.status === 401) {
      errorMessage = 'AI服务认证失败，请检查API密钥';
    }
    else if (error.response?.status >= 500) {
      errorMessage = 'AI服务暂时不可用，请稍后重试';
    }

    safeJsonResponse(res, { 
      error: errorMessage, 
      details: errorDetails,
      status: error.response?.status || 500
    }, 500);
  }
});

// AI文字处理接口
app.post('/tools/ai_writing', async (req, res) => {
  try {
    const { content, command, model } = req.body;
    
    if (!content || !command) {
      return safeJsonResponse(res, { error: '缺少必要参数: content, command' }, 400);
    }

    // 使用默认模型（豆包）
    const selectedModel = model || 'ark-doubao-seed-1.6-flash';

    const commandMap = {
      '改写': `请重新表述以下内容，保持原意但改变表达方式：\n\n${content}`,
      '扩写': `请详细扩展以下内容，增加相关信息和细节：\n\n${content}`,
      '缩写': `请精简以下内容，保留核心信息：\n\n${content}`
    };

    const prompt = commandMap[command] || content;

    const messages = [
      {
        role: 'user',
        content: prompt
      }
    ];

    const response = await callAI(selectedModel, messages, true);

    // 设置流式响应头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    // 流式传输响应
    response.data.pipe(res);

  }
  catch (error) {
    console.error('AI文字处理失败:', error);
    
    // 安全地提取错误信息，避免循环引用
    let errorDetails = 'Unknown error';
    if (error.response?.data) {
      errorDetails = error.response.data;
    }
    else if (error.message) {
      errorDetails = error.message;
    }
    else if (typeof error === 'string') {
      errorDetails = error;
    }

    // 检查特定错误类型
    let errorMessage = 'AI服务异常';
    if (error.response?.status === 429) {
      errorMessage = 'AI服务请求频率限制，请稍后重试';
    }
    else if (error.response?.status === 401) {
      errorMessage = 'AI服务认证失败，请检查API密钥';
    }
    else if (error.response?.status >= 500) {
      errorMessage = 'AI服务暂时不可用，请稍后重试';
    }

    safeJsonResponse(res, { 
      error: errorMessage, 
      details: errorDetails,
      status: error.response?.status || 500
    }, 500);
  }
});

// 修复的JSON响应函数，防止循环引用
function safeJsonStringify(obj) {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, val) => {
    if (val !== null && typeof val === 'object') {
      if (seen.has(val)) {
        return '[Circular]';
      }
      seen.add(val);
    }
    return val;
  });
}

// 安全的JSON响应中间件
const safeJsonResponse = (res, data, statusCode = 200) => {
  try {
    res.status(statusCode).json(data);
  }
  catch (error) {
    if (error.message.includes('circular')) {
      console.error('Circular reference detected, attempting to fix:', error);
      res.status(statusCode).send(safeJsonStringify(data));
    }
    else {
      throw error;
    }
  }
};

// 健康检查接口
app.get('/health', (req, res) => {
  safeJsonResponse(res, { 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    models: Object.keys(MODEL_CONFIGS)
  });
});

// 根路径
app.get('/', (req, res) => {
  res.json({ 
    message: 'PPTist AI Backend Service',
    version: '1.0.0',
    endpoints: [
      'POST /tools/aippt_outline - 生成PPT大纲',
      'POST /tools/aippt - 生成完整PPT', 
      'POST /tools/ai_writing - AI文字处理',
      'GET /health - 健康检查'
    ]
  });
});

// 错误处理中间件
app.use((error, req, res, next) => {
  console.error('服务器错误:', error);
  res.status(500).json({ 
    error: '服务器内部错误', 
    details: process.env.NODE_ENV === 'development' ? error.message : undefined 
  });
  // 标记next参数为已使用（Express错误处理中间件需要这个参数）
  void next;
});

// 404处理
app.use((req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
  console.log(`PPTist AI后端服务启动成功！`);
  console.log(`本地访问: http://localhost:${PORT}`);
  console.log(`局域网访问: http://192.168.1.119:${PORT}`);
  console.log(`健康检查: http://192.168.1.119:${PORT}/health`);
  console.log(`环境: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
