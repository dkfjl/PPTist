const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const PptxGenJS = require('pptxgenjs');
const { exec } = require('child_process');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Python配置
const PYTHON_WORK_DIR = process.env.PYTHON_WORK_DIR || path.join(__dirname, 'python_ppt');
// PPTX 导出目录（复用 Python 工作目录下的 exports 子目录）
const PPTX_EXPORT_DIR = path.join(PYTHON_WORK_DIR, 'exports');

// 确保 Python 工作目录和 PPTX 导出目录存在
try {
  if (!fs.existsSync(PYTHON_WORK_DIR)) {
    fs.mkdirSync(PYTHON_WORK_DIR, { recursive: true });
  }
  if (!fs.existsSync(PPTX_EXPORT_DIR)) {
    fs.mkdirSync(PPTX_EXPORT_DIR, { recursive: true });
  }
}
catch (e) {
  console.warn('创建Python工作 / PPTX导出目录失败:', e);
}

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

// 静态服务：对外暴露 PPTX 导出目录
// 例如：http://localhost:3001/exports/xxxx.pptx
app.use('/exports', express.static(PPTX_EXPORT_DIR));

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
        temperature: 0.5,
        // 使用更安全的 token 上限，避免第三方 OpenAI 兼容服务因上限过大返回 400
        max_tokens: 4096
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

    // 处理流式数据，解析OpenAI格式并传输纯净内容
    response.data.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            res.end();
            return;
          }
          
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              // 直接传输内容，前端会累积处理
              res.write(content);
            }
          }
          catch (e) {
            console.error('解析流式数据失败:', e);
          }
        }
      }
    });

    response.data.on('end', () => {
      res.end();
    });

    response.data.on('error', (err) => {
      console.error('流式响应错误:', err);
      res.end();
    });

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

    // 这里改为非流式调用，拿到完整内容后再切分为多行 JSON 对象
    const aiResponse = await callAI(model, messages, false);
    const rawText = aiResponse.data?.choices?.[0]?.message?.content || '';

    if (!rawText) {
      return safeJsonResponse(res, { error: 'AI未返回内容', details: aiResponse.data }, 500);
    }

    // 设置流式响应头（前端依旧按流式读取）
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    // 按行解析 AI 返回内容：
    // - 忽略 ``` / ```json 这类代码块标记
    // - 每一行如果是合法 JSON，就原样写回给前端（一行一个对象）
    const lines = rawText.split('\n');
    for (let line of lines) {
      line = line.trim();
      if (!line) continue;

      // 跳过代码块标记行
      if (line.startsWith('```')) continue;

      try {
        const obj = JSON.parse(line);
        res.write(JSON.stringify(obj) + '\n');
      }
      catch (e) {
        // 不是合法 JSON 行就忽略，避免中断整个生成过程
        console.warn('跳过无法解析的 JSON 行:', line);
      }
    }

    res.end();

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

// 工具函数：将 rgb(...) / #xxxxxx / 纯 hex 转为 6 位 HEX 字符串
function toHexColor(color, fallback = 'FFFFFF') {
  if (!color || typeof color !== 'string') return fallback;
  let c = color.trim();

  // 去掉开头的 #
  if (c.startsWith('#')) c = c.slice(1);

  // 已经是 6 位 hex
  if (/^[0-9a-fA-F]{6}$/.test(c)) {
    return c.toUpperCase();
  }

  // rgb 或 rgba 格式
  const rgbMatch = color.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (rgbMatch) {
    const clamp = (n) => Math.max(0, Math.min(255, n));
    const r = clamp(parseInt(rgbMatch[1], 10));
    const g = clamp(parseInt(rgbMatch[2], 10));
    const b = clamp(parseInt(rgbMatch[3], 10));
    const toHex = (n) => n.toString(16).padStart(2, '0').toUpperCase();
    return `${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  return fallback;
}

// 根据 style 加载 PPTist 模板的主题信息（仅使用颜色等简单字段）
function loadTemplateTheme(style) {
  const styleTemplateMap = {
    '学术风': 'template_2',
    '职场风': 'template_3',
    '教育风': 'template_4',
    '营销风': 'template_5',
  };
  const templateId = styleTemplateMap[style] || 'template_1';
  const templatePath = path.join(__dirname, '..', 'public', 'mocks', `${templateId}.json`);

  try {
    const json = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
    return json.theme || {};
  }
  catch (err) {
    console.warn('加载模板失败, 使用默认主题:', err?.message || err);
    return {};
  }
}

// 将 AI 生成的 AIPPT slides + 模板主题转换为 PPTX 文件，并返回下载 URL
async function generatePptxFromAIPPTSlides(slides, { language, style }) {
  if (!Array.isArray(slides) || slides.length === 0) {
    throw new Error('没有可用的 PPT 数据');
  }

  const pptx = new PptxGenJS();
  // 使用标准 16:9 布局
  pptx.layout = 'LAYOUT_16x9';

  const theme = loadTemplateTheme(style);
  const bgColor = toHexColor(theme.backgroundColor || '#FFFFFF', 'FFFFFF');
  const accentColor = toHexColor(
    (Array.isArray(theme.themeColors) && theme.themeColors[0]) || '#2E75B6',
    '2E75B6'
  );
  const fontColor = toHexColor(theme.fontColor || '#333333', '333333');

  const lang = language || '中文';

  slides.forEach((slide) => {
    const s = pptx.addSlide();
    s.background = { color: bgColor };

    if (!slide || typeof slide !== 'object' || !slide.type) return;

    if (slide.type === 'cover' && slide.data) {
      const title = slide.data.title || (lang === 'English' ? 'Title' : '标题');
      const sub = slide.data.text || '';
      s.addText(title, {
        x: 0.5,
        y: 1.0,
        w: 9,
        h: 1.2,
        fontSize: 32,
        bold: true,
        align: 'center',
        color: accentColor,
      });
      if (sub) {
        s.addText(sub, {
          x: 1.0,
          y: 2.2,
          w: 8,
          h: 1.5,
          fontSize: 18,
          align: 'center',
          color: fontColor,
        });
      }
    }
    else if (slide.type === 'contents' && slide.data) {
      const title = lang === 'English' ? 'Contents' : '目录';
      s.addText(title, {
        x: 0.5,
        y: 0.7,
        w: 9,
        h: 1.0,
        fontSize: 28,
        bold: true,
        color: accentColor,
      });
      const items = Array.isArray(slide.data.items) ? slide.data.items.filter(Boolean) : [];
      if (items.length) {
        s.addText(items.join('\n'), {
          x: 1.0,
          y: 1.8,
          w: 8,
          h: 4,
          fontSize: 18,
          color: fontColor,
          bullet: true,
        });
      }
    }
    else if (slide.type === 'transition' && slide.data) {
      const title = slide.data.title || (lang === 'English' ? 'Part' : '章节');
      const text = slide.data.text || '';
      s.addText(title, {
        x: 0.5,
        y: 1.2,
        w: 9,
        h: 1.2,
        fontSize: 30,
        bold: true,
        align: 'center',
        color: accentColor,
      });
      if (text) {
        s.addText(text, {
          x: 1.0,
          y: 2.5,
          w: 8,
          h: 2.5,
          fontSize: 20,
          color: fontColor,
          align: 'center',
        });
      }
    }
    else if (slide.type === 'content' && slide.data) {
      const title = slide.data.title || '';
      const items = Array.isArray(slide.data.items) ? slide.data.items : [];

      if (title) {
        s.addText(title, {
          x: 0.5,
          y: 0.7,
          w: 9,
          h: 1.0,
          fontSize: 26,
          bold: true,
          color: accentColor,
        });
      }

      if (items.length) {
        const lines = items.map((it) => {
          if (!it) return '';
          const tTitle = it.title ? `${it.title}：` : '';
          const tText = it.text || '';
          return `${tTitle}${tText}`;
        }).filter(Boolean);

        if (lines.length) {
          s.addText(lines.join('\n'), {
            x: 0.8,
            y: 1.8,
            w: 8.4,
            h: 4,
            fontSize: 18,
            color: fontColor,
            bullet: true,
          });
        }
      }
    }
    else if (slide.type === 'end') {
      const endText = lang === 'English' ? 'Thank you' : '谢谢聆听';
      s.addText(endText, {
        x: 0.5,
        y: 2.0,
        w: 9,
        h: 1.5,
        fontSize: 30,
        bold: true,
        align: 'center',
        color: accentColor,
      });
    }
  });

  const fileName = `aippt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.pptx`;
  const absPath = path.join(PPTX_EXPORT_DIR, fileName);

  // Node 环境：写入本地文件
  await pptx.writeFile({ fileName: absPath });

  // 返回对外可访问的 URL
  return `/exports/${fileName}`;
}

// AIPPT：生成内容并自动导出 PPTX，返回下载地址
app.post('/tools/aippt_with_action', async (req, res) => {
  try {
    const { content, language, style, model, slides } = req.body;

    // language、style 始终是必填；content / model 在未提供 slides 时必填
    if (!language || !style) {
      return safeJsonResponse(res, { error: '缺少必要参数: language, style' }, 400);
    }

    // 统一使用 finalSlides 变量：
    // - 如果 body 中直接传入 slides（可选，推荐 AIPPTSlide[] 结构），则优先使用该数据生成 PPTX
    // - 否则按原逻辑走 AI，大纲 -> AIPPTSlide[]
    let finalSlides = null;

    // 1. 优先使用调用方直接传入的 slides 数据
    if (slides) {
      let parsedSlides = slides;

      // 兼容 slides 传字符串（JSON）的情况
      if (typeof slides === 'string') {
        try {
          parsedSlides = JSON.parse(slides);
        }
        catch (e) {
          console.error('解析 slides 字符串失败:', e);
          return safeJsonResponse(res, {
            error: 'slides 参数解析失败，请传入合法的 JSON 字符串或数组',
            details: e.message || String(e),
          }, 400);
        }
      }

      if (!Array.isArray(parsedSlides) || !parsedSlides.length) {
        return safeJsonResponse(res, {
          error: 'slides 参数必须是非空数组',
        }, 400);
      }

      finalSlides = parsedSlides;
    }

    // 2. 未提供 slides 时，回退到原有逻辑：根据大纲 + 模型自动生成 slides
    if (!finalSlides) {
      if (!content || !model) {
        return safeJsonResponse(res, {
          error: '当未提供 slides 时，必须提供 content 和 model',
        }, 400);
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

      // 仍然使用一次性调用 AI，拿到完整内容后再解析
      const aiResponse = await callAI(model, messages, false);
      const rawText = aiResponse.data?.choices?.[0]?.message?.content || '';

      if (!rawText) {
        return safeJsonResponse(res, { error: 'AI未返回内容', details: aiResponse.data }, 500);
      }

      const aiSlides = [];

      // 按行解析 AI 返回内容：
      // - 忽略 ``` / ```json 这类代码块标记
      // - 每一行如果是合法 JSON，就加入 slides 数组
      const lines = rawText.split('\n');
      for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        // 跳过代码块标记行
        if (line.startsWith('```')) continue;

        try {
          const obj = JSON.parse(line);
          aiSlides.push(obj);
        }
        catch (e) {
          console.warn('跳过无法解析的 JSON 行:', line);
        }
      }

      if (!aiSlides.length) {
        return safeJsonResponse(res, { error: 'AI未生成任何 PPT 页内容', details: rawText }, 500);
      }

      finalSlides = aiSlides;
    }

    // 根据 AI 生成的 slides + 模板主题自动生成 PPTX，并返回下载地址
    const pptxUrl = await generatePptxFromAIPPTSlides(finalSlides, { language, style });

    return safeJsonResponse(res, {
      success: true,
      message: 'PPTX生成完成',
      url: pptxUrl,
      // 如有需要也可以返回 slides 供前端调试使用
      slides: finalSlides,
    });

  }
  catch (error) {
    console.error('AIPPT_WITH_ACTION 生成失败:', error);
    
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
      'POST /tools/aippt_with_action - 生成伴随动作的ppt',
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
app.use((_req, res) => {
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
