# 🎨 Pollinations MCP Server

A **Model Context Protocol (MCP)** server that connects AI agents to [Pollinations.ai](https://pollinations.ai) for seamless image and text generation. Designed specifically for **n8n** workflows with Server-Sent Events (SSE) support.

[![Docker](https://img.shields.io/badge/Docker-Ready-blue?logo=docker)](https://docker.com)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green?logo=node.js)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-2024--11--05-purple)](https://modelcontextprotocol.io)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## ✨ Features

- 🖼️ **Image Generation** - Create stunning images from text prompts using Pollinations AI
- 📝 **Text Generation** - Generate content with multiple AI models (OpenAI, Claude, Mistral, etc.)
- 🔍 **Model Discovery** - List and explore available AI models
- 🌐 **SSE Support** - Compatible with n8n's native MCP Client Tool
- 🐳 **Docker Ready** - Easy deployment with Docker containers
- 🚀 **Production Ready** - Includes logging, health checks, and error handling
- 🔒 **Secure** - Optional authentication and CORS protection
- ⚡ **Fast** - Efficient connection management and response streaming

## 🎯 Perfect For

- **n8n Automation Workflows** - Enhance AI agents with creative capabilities
- **Content Creation Pipelines** - Automated blog posts with matching visuals
- **Social Media Automation** - Generate posts with custom images
- **E-commerce Solutions** - Product descriptions with generated visuals
- **Marketing Campaigns** - Custom content and imagery at scale
- **Documentation Tools** - Technical docs with AI-generated diagrams

## 🚀 Quick Start

### 🐳 Docker (Recommended)

```bash
# Run with Docker
docker run -p 3000:3000 ghcr.io/jpbester/pollinations-mcp-server

# Or build locally
git clone https://github.com/jpbester/pollinations-mcp-server.git
cd pollinations-mcp-server
docker build -t pollinations-mcp .
docker run -p 3000:3000 pollinations-mcp
```

### 📦 Local Development

```bash
# Clone the repository
git clone https://github.com/jpbester/pollinations-mcp-server.git
cd pollinations-mcp-server

# Install dependencies
npm install

# Start the server
npm start

# For development with auto-reload
npm run dev
```

### ☁️ Deploy to Cloud

**Railway:**
```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

**Render/Heroku/EasyPanel:**
- Connect your GitHub repository
- Set build command: `npm install`
- Set start command: `npm start`
- Deploy! ✨

## 🔧 n8n Integration

### Step 1: Add Nodes to Your Workflow
1. **AI Agent** node (OpenAI Agent, Anthropic Agent, etc.)
2. **MCP Client Tool** node

### Step 2: Configure MCP Client Tool
- **SSE Endpoint**: `https://your-domain.com/sse`
- **Authentication**: None (or Bearer if you set API_KEY)
- **Tools to Include**: All

### Step 3: Configure AI Agent
Add this system prompt to your AI Agent:
```
You are an AI assistant with access to powerful content generation tools:

- Use generate_image when users ask for images, artwork, or visual content
- Use generate_text when users need written content, stories, or text generation
- Use list_models to show available AI models

Always provide helpful context about what you're generating and how to use the results.
```

### Step 4: Test Your Setup
Ask your AI agent things like:
- *"Generate an image of a futuristic city at sunset"*
- *"Create a short story about space exploration"*
- *"What image generation models are available?"*

## 🛠️ Available Tools

### 🖼️ `generate_image`
Create images from text prompts with customizable parameters.

**Parameters:**
- `prompt` (required) - Text description of the image
- `width` (optional) - Image width in pixels (default: 1024)
- `height` (optional) - Image height in pixels (default: 1024)
- `model` (optional) - Generation model: `flux`, `turbo`, `flux-realism`, `flux-cablyai`, `any-dark`
- `seed` (optional) - Random seed for reproducible results

**Example Result:**
```json
{
  "tool": "generate_image",
  "result": {
    "success": true,
    "base64": "iVBORw0KGgoAAAANSUhEUgAA...",
    "url": "https://image.pollinations.ai/prompt/...",
    "contentType": "image/png"
  },
  "metadata": {
    "prompt": "A futuristic city at sunset",
    "timestamp": "2024-01-01T12:00:00.000Z"
  }
}
```

### 📝 `generate_text`
Generate text content using various AI language models.

**Parameters:**
- `prompt` (required) - Text prompt for content generation
- `model` (optional) - Language model: `openai`, `mistral`, `claude`, `llama`, `gemini`

**Example Result:**
```json
{
  "tool": "generate_text",
  "result": {
    "success": true,
    "content": "Generated text content..."
  },
  "metadata": {
    "prompt": "Write a story about AI",
    "model": "openai",
    "timestamp": "2024-01-01T12:00:00.000Z"
  }
}
```

### 🔍 `list_models`
Discover all available models for image and text generation.

**Example Result:**
```json
{
  "tool": "list_models",
  "result": {
    "image": ["flux", "turbo", "flux-realism", "flux-cablyai", "any-dark"],
    "text": ["openai", "mistral", "claude", "llama", "gemini"]
  }
}
```

## 📡 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check and server stats |
| `/sse` | GET | SSE endpoint for MCP protocol (n8n) |
| `/message` | POST | Send MCP messages |
| `/mcp` | GET/POST | Unified MCP endpoint |
| `/api/test` | GET | Simple test endpoint |

## ⚙️ Configuration

### Environment Variables

```bash
# Server Configuration
NODE_ENV=production          # Environment mode
PORT=3000                   # Server port
LOG_LEVEL=info             # Logging level (debug, info, warn, error)

# CORS Configuration  
ALLOWED_ORIGINS=*          # Allowed CORS origins (comma-separated)

# Optional Authentication
API_KEY=your-secret-key    # Enable API key authentication

# Rate Limiting (optional)
RATE_LIMIT_WINDOW_MS=900000    # Rate limit window (15 min)
RATE_LIMIT_MAX_REQUESTS=100    # Max requests per window
```

### Docker Environment
```bash
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  -e LOG_LEVEL=info \
  -e ALLOWED_ORIGINS=https://your-n8n-instance.com \
  pollinations-mcp
```

## 🔒 Security

### Optional Authentication
Enable API key authentication by setting the `API_KEY` environment variable:

```bash
export API_KEY=your-secure-api-key
```

Then configure n8n MCP Client:
- **Authentication**: Bearer
- **Token**: `your-secure-api-key`

### CORS Protection
Restrict origins by setting `ALLOWED_ORIGINS`:
```bash
export ALLOWED_ORIGINS=https://your-n8n-instance.com,https://your-domain.com
```

## 🧪 Testing

### Health Check
```bash
curl https://your-domain.com/health
```

### SSE Connection Test
```bash
curl -N -H "Accept: text/event-stream" https://your-domain.com/sse
```

### Manual Tool Test
```bash
curl -X POST https://your-domain.com/message \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "generate_image",
      "arguments": {
        "prompt": "A beautiful sunset",
        "width": 512,
        "height": 512
      }
    }
  }'
```

## 🐛 Troubleshooting

### Common Issues

**n8n can't connect to localhost:**
- Deploy to a public URL (Railway, Render, EasyPanel)
- Use ngrok for local testing: `ngrok http 3000`

**Connection timeout:**
- Check server health: `curl https://your-domain.com/health`
- Verify SSE endpoint: `curl -N https://your-domain.com/sse`

**Tools not showing in n8n:**
- Ensure MCP Client is connected to AI Agent
- Set "Tools to Include" to "All"
- Check server logs for connection issues

**CORS errors:**
- Set `ALLOWED_ORIGINS` environment variable
- Ensure your n8n domain is included

### Debug Mode
```bash
LOG_LEVEL=debug npm start
```

## 📊 Monitoring

### Health Endpoint Response
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "activeConnections": 2,
  "uptime": 3600,
  "version": "1.0.0"
}
```

### Logs
The server provides structured logging for:
- SSE connections and disconnections
- MCP message exchanges
- Tool calls and responses
- Errors and warnings

## 🤝 Contributing

We welcome contributions! Here's how to get started:

1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feature/amazing-feature`
3. **Commit** your changes: `git commit -m 'Add amazing feature'`
4. **Push** to the branch: `git push origin feature/amazing-feature`
5. **Open** a Pull Request

### Development Setup
```bash
git clone https://github.com/jpbester/pollinations-mcp-server.git
cd pollinations-mcp-server
npm install
npm run dev
```

## 📋 Examples

### n8n Workflow Examples

**1. Blog Post Generator with Image**
- Trigger: Webhook or Schedule
- AI Agent: "Create a blog post about [topic] with a hero image"
- Tools: `generate_text` → `generate_image`
- Output: Complete blog post with matching visual

**2. Social Media Content Creator**
- Trigger: New RSS item
- AI Agent: "Create a social post with image for this article"
- Tools: `generate_text` → `generate_image`
- Output: Post text + image ready for social platforms

**3. Product Description Generator**
- Trigger: New product in database
- AI Agent: "Create description and product image"
- Tools: `generate_text` → `generate_image`
- Output: Marketing-ready product content

## 🌟 Use Cases

- **Content Marketing** - Automated blog posts with custom imagery
- **Social Media Management** - Generated posts with matching visuals
- **E-commerce** - Product descriptions and lifestyle images
- **Documentation** - Technical guides with generated diagrams
- **Creative Projects** - Story generation with character illustrations
- **Presentations** - Slide content with custom graphics
- **Email Campaigns** - Personalized content with themed images

## 🔗 Related Projects

- [Model Context Protocol](https://modelcontextprotocol.io) - Official MCP specification
- [Pollinations.ai](https://pollinations.ai) - Free AI content generation
- [n8n](https://n8n.io) - Workflow automation platform
- [n8n MCP Client Documentation](https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolmcp/)

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Pollinations.ai](https://pollinations.ai) for providing free AI generation APIs
- [Anthropic](https://anthropic.com) for creating the Model Context Protocol
- [n8n](https://n8n.io) for building an amazing automation platform
- The open-source community for continuous inspiration

## 📞 Support

- **Documentation**: Check this README and inline code comments
- **Issues**: [GitHub Issues](https://github.com/your-username/pollinations-mcp-server/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-username/pollinations-mcp-server/discussions)

---

**Made with ❤️ for the AI automation community**

⭐ **Star this repo** if it helps your projects!
