<h1 align="center">Aider</h1>

<p align="center">
  <a href="https://github.com/youill0317/Aider/wiki">Documentation</a>
  ·
  <a href="https://github.com/youill0317/Aider/issues">Report Bug</a>
  ·
  <a href="https://github.com/youill0317/Aider/discussions">Discussions</a>
</p>

> [!NOTE]
> **What's New**
>
> **v2.0.0** - Aider is the maintained successor fork of Smart Composer. It automatically adopts existing Smart Composer settings, chats, templates, RAG vector storage, and provider secrets into Aider-owned paths without deleting legacy data. Existing Aider data wins on conflicts, so the Smart Composer folder remains a rollback source. The first Aider release intentionally keeps internal `<smtcmp_block>` prompt tags and `smtcmp-*` CSS selectors for compatibility.
>
> **🔌 MCP Support** — Connect Aider to external tools and data sources via the [Model Context Protocol](https://modelcontextprotocol.io)

> ### Risks of connecting a Claude subscription
> 
> As of January 2026, Anthropic has restricted third-party OAuth access, citing Terms of Service violations.
> 
> Aider's subscription connect uses the same OAuth-style flow that tools like OpenCode have used. There are reports of **Claude accounts being banned or restricted** when subscription OAuth is used via third-party clients (example: [https://github.com/anomalyco/opencode/issues/6930](https://github.com/anomalyco/opencode/issues/6930)). For **OpenAI (ChatGPT)** and **Google (Gemini)**, I have not seen comparable ban reports so far, but this is still not the same as official API access, and enforcement can change at any time.
> 
> **Use at your own risk.** Keep usage limited to personal, interactive sessions and avoid any automation.

> ### Security and data flow
>
> Aider stores API keys and OAuth tokens through Obsidian `app.secretStorage` when that API is available. On older Obsidian runtimes without `app.secretStorage`, the plugin keeps working through a fallback settings path; that fallback is less secure because secrets are protected only as ordinary local plugin data. The `minAppVersion` remains unchanged because this fallback exists. Requiring secure storage for every user would require Obsidian 1.11.4+.
>
> Subscription OAuth uses third-party or internal provider endpoints and should be treated as use-at-your-own-risk, separate from official usage-based API keys. MCP tools can run local commands, and MCP tool output may be sent to the selected LLM provider. MCP server `env` values are ordinary plugin settings, not Obsidian `app.secretStorage` entries. Vault content is also sent to providers when you include files, folders, current-file context, Vault Search/RAG results, web content, images, or tool results in a chat.

![SC1_Title.gif](https://github.com/user-attachments/assets/a50a1f80-39ff-4eba-8090-e3d75e7be98c)

Every time we ask ChatGPT, we need to include context for each query. Why spend time adding background information that is already in your vault?

**Aider is an Obsidian plugin that helps you write efficiently with AI by easily referencing your vault content.** Inspired by Cursor AI and ChatGPT Canvas, this plugin unifies your note-taking and content creation process within Obsidian.

## Features

### Contextual Chat

![SC2_ContextChat.gif](https://github.com/user-attachments/assets/8da4c189-399a-450a-9591-95f1c9af1bc8)

Upgrade your note-taking experience with our Contextual AI Assistant, inspired by Cursor AI. Unlike typical AI plugins, our assistant allows you to **precisely select the context for your conversation.**

- Type `@<fname>` to choose specific files/folders as your conversation context
- Get responses based on selected vault content

#### Multimedia Context

<img src="https://github.com/user-attachments/assets/b22175d4-80a2-4122-8555-2b9dd4987f93" alt="SC2-2_MultiContext.png" width="360"/>

Now, you can **add website links and images** as additional context for your queries.

- Website content is automatically extracted
- **Image support**: Add images directly to your chat through:
  - Upload button
  - Drag & drop
  - Paste from clipboard
- **Youtube link support**: YouTube transcripts are fetched and included as context
- **Coming soon**: Support for external files (PDF, DOCX, ...)

### Apply Edit

![SC3_ApplyEdit.gif](https://github.com/user-attachments/assets/35ee03ff-4a61-4d08-8032-ca61fb37dcf1)

Aider **suggests edits to your document.** You can apply with a single click.

- Offers document change recommendations
- Apply suggested changes instantly

### Vault Search (RAG)

![SC4_RAG-ezgif.com-crop-video.gif](https://github.com/user-attachments/assets/91c3ab8d-56d7-43b8-bb4a-1e73615a40ec)

**Automatically find and use relevant notes** from your vault to enhance AI responses.

- Hit `Cmd+Shift+Enter` to run Vault Search answer
- Semantic search across your vault to find the most relevant context

### Model Context Protocol (MCP)

![mcp_demo](https://github.com/user-attachments/assets/4c80a1af-4cbf-4aa4-90d2-457499553357)

Connect Aider to external MCP servers.
MCP lets you use powerful third-party tools and data sources right inside your chat.

### Additional Features

- **Custom Model Selection**: Use your own model by setting your API Key (stored locally). Supported API providers:
  - OpenAI
  - Anthropic
  - Google (Gemini)
  - Groq
  - DeepSeek
  - OpenRouter
  - Azure OpenAI
  - Ollama
  - LM Studio
  - MorphLLM
  - Any other OpenAI-compatible providers
- **Local Model Support**: Run open-source LLMs and embedding models locally with [Ollama](https://ollama.ai) for complete privacy and offline usage.
- **Custom System Prompts**: Define your own system prompts that will be applied to every chat conversation.
- **Prompt Templates**: Create and reuse templates for common queries by typing `/` in the chat view. Perfect for standardizing repetitive tasks.
  - Create templates from any selected text with one click

## Getting Started

> [!IMPORTANT]
> **Installer Version Requirement**  
> Aider requires a recent version of the Obsidian installer. If you experience issues with the plugin not loading properly:
> 
> 1. First, try updating Obsidian normally at `Settings > General > Check for updates`.
> 
> 2. If issues persist, manually update your Obsidian installer:
>    - Download the latest installer from [Obsidian's download page](https://obsidian.md/download)
>    - Close Obsidian completely
>    - Run the new installer

### Install from a release

Until the Aider community-plugin listing is accepted, install the release artifacts manually:

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest GitHub release.
2. Create `<your-vault>/.obsidian/plugins/aider`.
3. Copy the three downloaded files into that `aider` folder.
4. Restart Obsidian.
5. Open `Settings > Community plugins`, enable installed plugins if needed, and enable Aider.

After Aider is listed in Obsidian's community-plugin catalog, you can install it from `Settings > Community plugins > Browse` by searching for "Aider".

### Set up providers

- **Connect subscription (no API key)**: Connect your Claude/OpenAI/Gemini account in `Settings > Aider > Connect your subscription`
- **API Providers (usage-based billing)**: Add an API key in `Settings > Aider > Providers`
  - OpenAI: [ChatGPT API Keys](https://platform.openai.com/api-keys)
  - Anthropic: [Claude API Keys](https://console.anthropic.com/settings/keys)
  - Gemini: [Gemini API Keys](https://aistudio.google.com/apikey)

> [!TIP]
> **Looking for a free option?**  
> Gemini API provides the best performance among free models for Aider. Recommended for users looking for a free option.
> _When using free APIs, please review the provider’s privacy policy before sending sensitive data._

**📚 For detailed setup instructions and documentation, please visit our [Documentation](https://github.com/youill0317/Aider/wiki).**

## Migrating from Smart Composer

Aider adopts Smart Composer data on first load and writes to Aider-owned paths after that:

- Plugin settings: `.obsidian/plugins/smart-composer/data.json` -> `.obsidian/plugins/aider/data.json`
- JSON chats and templates: `.smtcmp_json_db` -> `.aider_json_db`
- RAG vector storage: `.smtcmp_vector_db.tar.gz` -> `.aider_vector_db.tar.gz`
- Legacy chat history files: `.smtcmp_chat_histories` -> `.aider_chat_histories`
- Provider secrets: `smart-composer-provider-*` -> `aider-provider-*`

Existing Aider data is never overwritten by imported Smart Composer data, and legacy Smart Composer files are not deleted. This keeps rollback possible while Aider takes ownership of future writes.

You can keep Smart Composer installed while checking the migration. After both plugins load, they use separate data paths, so new chats, templates, and RAG index updates can diverge. Disable Smart Composer once Aider is confirmed working unless you intentionally want both plugins active.

To rebuild the RAG vector store from scratch, run Aider's `Rebuild entire vault index` command from Obsidian's command palette.

## Roadmap

To see our up-to-date project roadmap and progress, please check out our [GitHub Projects kanban board](https://github.com/youill0317/Aider/projects?query=is%3Aopen).

Some of our planned features include:

- Support for external files (PDF, DOCX, etc.)
- Mentioning with tags or other metadata

## Feedback and Support

We value your input and want to ensure you can easily share your thoughts and report any issues:

- **Bug Reports**: If you encounter any bugs or unexpected behavior, please submit an issue on our [GitHub Issues](https://github.com/youill0317/Aider/issues) page. Be sure to include as much detail as possible to help us reproduce and address the problem.

- **Feature Requests**: For new feature ideas or enhancements, please use our [GitHub Discussions - Ideas & Feature Requests](https://github.com/youill0317/Aider/discussions/categories/ideas-feature-requests) page. Create a new discussion to share your suggestions. This allows for community engagement and helps us prioritize future developments.

- **Show and Tell**: We love seeing how you use Aider! Share your unique use cases, workflows, or interesting applications of the plugin in [GitHub Discussions](https://github.com/youill0317/Aider/discussions).

Your feedback and experiences are crucial in making Aider better for everyone!

## Contributing

We welcome all kinds of contributions to Aider, including bug reports, bug fixes, documentation improvements, and feature enhancements.

**For major feature ideas, please create an issue first to discuss feasibility and implementation approach.**

If you're interested in contributing, please refer to our [CONTRIBUTING.md](CONTRIBUTING.md) file for detailed information on:

- Setting up the development environment
- Our development workflow
- Working with the database schema
- The process for submitting pull requests
- Known issues and solutions for developers

## Upstream Provenance

Aider is a successor fork of [Smart Composer](https://github.com/glowingjade/obsidian-smart-composer). The upstream project was created by Heesu Suh and released under the MIT License. This repository preserves that license and provenance while routing current support and documentation to [youill0317/Aider](https://github.com/youill0317/Aider).

### Upstream Core Team

These contributors were instrumental in shaping the initial vision, architecture, and design of Smart Composer:

**[@glowingjade](https://github.com/glowingjade)** ([Twitter](https://x.com/andy_suh_)), **[@kevin-on](https://github.com/kevin-on)**, **[@realsnoopso](https://github.com/realsnoopso)** ([Twitter](https://twitter.com/RealSnoopSo) · [LinkedIn](https://linkedin.com/in/realsnoopso)), **[@woosukji](https://github.com/woosukji)**

## License

This project is licensed under the [MIT License](LICENSE).

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=youill0317/Aider&type=Date)](https://star-history.com/#youill0317/Aider&Date)
