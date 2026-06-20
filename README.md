<h1 align="center">Aider</h1>

<p align="center">
  <a href="https://github.com/youill0317/Aider/releases">Releases</a>
  ·
  <a href="https://github.com/youill0317/Aider/issues">Report Bug</a>
  ·
  <a href="https://github.com/youill0317/Aider/discussions">Discussions</a>
</p>

## Aider Update

Aider is a maintained successor fork of [Smart Composer](https://github.com/glowingjade/obsidian-smart-composer). It keeps the original Smart Composer experience as the foundation, while continuing development under a new plugin identity and separate storage paths.

The original Smart Composer README is preserved below for provenance. This top section describes what is specific to Aider.

### Current release

- Version: `2.0.0`
- Plugin id: `aider`
- GitHub release: [2.0.0](https://github.com/youill0317/Aider/releases/tag/2.0.0)
- Release assets: `main.js`, `manifest.json`, `styles.css`

### What Aider adds on top of Smart Composer

- Successor-fork migration from Smart Composer to Aider-owned plugin metadata and storage paths.
- Automatic adoption of existing Smart Composer settings, chat/template JSON storage, legacy chat histories, RAG vector storage, and provider secrets.
- Codex-based Agent Chat support, visible Codex tool activity, and Agent Chat keyboard shortcut support.
- Voyage AI embedding provider support and contextual RAG embedding improvements.
- Credential, MCP, and Codex execution-boundary hardening for safer local use.
- GitHub Release based manual installation while Obsidian community-plugin listing is not yet available.

### Install Aider from GitHub Releases

Until Aider is listed in Obsidian's community-plugin catalog, install it manually:

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [Aider release](https://github.com/youill0317/Aider/releases).
2. Create `<your-vault>/.obsidian/plugins/aider`.
3. Copy the three downloaded files into that `aider` folder.
4. Restart Obsidian.
5. Open `Settings > Community plugins`, enable installed plugins if needed, and enable Aider.

### Migrating from Smart Composer

Aider adopts Smart Composer data on first load and writes to Aider-owned paths after that:

- Plugin settings: `.obsidian/plugins/smart-composer/data.json` -> `.obsidian/plugins/aider/data.json`
- JSON chats and templates: `.smtcmp_json_db` -> `.aider_json_db`
- RAG vector storage: `.smtcmp_vector_db.tar.gz` -> `.aider_vector_db.tar.gz`
- Legacy chat history files: `.smtcmp_chat_histories` -> `.aider_chat_histories`
- Provider secrets: `smart-composer-provider-*` -> `aider-provider-*`

Existing Aider data is never overwritten by imported Smart Composer data, and legacy Smart Composer files are not deleted. This keeps rollback possible while Aider takes ownership of future writes.

You can keep Smart Composer installed while checking the migration. After both plugins load, they use separate data paths, so new chats, templates, and RAG index updates can diverge. Disable Smart Composer once Aider is confirmed working unless you intentionally want both plugins active.

To rebuild the RAG vector store from scratch, run Aider's `Rebuild entire vault index` command from Obsidian's command palette.

### Security and data flow

Aider stores API keys and OAuth tokens through Obsidian `app.secretStorage` when that API is available. On older Obsidian runtimes without `app.secretStorage`, the plugin keeps working through a fallback settings path; that fallback is less secure because secrets are protected only as ordinary local plugin data. The `minAppVersion` remains unchanged because this fallback exists. Requiring secure storage for every user would require Obsidian 1.11.4+.

Subscription OAuth uses third-party or internal provider endpoints and should be treated as use-at-your-own-risk, separate from official usage-based API keys. MCP tools can run local commands, and MCP tool output may be sent to the selected LLM provider. MCP server `env` values are ordinary plugin settings, not Obsidian `app.secretStorage` entries. Vault content is also sent to providers when you include files, folders, current-file context, Vault Search/RAG results, web content, images, or tool results in a chat.

### Upstream provenance

Aider is based on Smart Composer by Heesu Suh and contributors, released under the MIT License. The fork preserves upstream provenance and license attribution while routing current Aider development, support, and releases to [youill0317/Aider](https://github.com/youill0317/Aider).

---

## Original Smart Composer README

The section below is preserved from Smart Composer at the fork baseline commit `6b38ab3`. Links, installation instructions, support channels, and project status in this preserved section refer to upstream Smart Composer, not Aider.

<h1 align="center">Smart Composer</h1>

<p align="center">
  <a href="https://github.com/glowingjade/obsidian-smart-composer/wiki">Documentation</a>
  ·
  <a href="https://github.com/glowingjade/obsidian-smart-composer/issues">Report Bug</a>
  ·
  <a href="https://github.com/glowingjade/obsidian-smart-composer/discussions">Discussions</a>
</p>

> [!NOTE]
> **What's New**
>
> **v1.2.8** — Connect your Gemini account
>
> **v1.2.7** — Connect your Claude or OpenAI account directly (no API key required)
>
> **v1.2.6** — Support for GPT-5.2, Opus 4.5, Gemini 3, and Grok 4.1
>
> **🔌 MCP Support** — Connect Smart Composer to external tools and data sources via the [Model Context Protocol](https://modelcontextprotocol.io)

> [!WARNING]
> **⚠️ Maintenance Notice**
>
> This plugin is currently maintained by a single developer and is **not under active development**.
> Occasional updates or bug fixes may still be released, but **issues and feature requests may not be reviewed promptly**.
>
> **🔗 Community Forks**
> A list of community-maintained forks is available in the [Community Fork Collection](https://github.com/glowingjade/obsidian-smart-composer/discussions/496).
> If you're maintaining a fork, feel free to add it there. And if you're simply interested in exploring alternative versions, you're welcome to check it out as well.

> ### Risks of connecting a Claude subscription
>
> As of January 2026, Anthropic has restricted third-party OAuth access, citing Terms of Service violations.
>
> Smart Composer's subscription connect uses the same OAuth-style flow that tools like OpenCode have used. There are reports of **Claude accounts being banned or restricted** when subscription OAuth is used via third-party clients (example: [https://github.com/anomalyco/opencode/issues/6930](https://github.com/anomalyco/opencode/issues/6930)). For **OpenAI (ChatGPT)** and **Google (Gemini)**, I have not seen comparable ban reports so far, but this is still not the same as official API access, and enforcement can change at any time.
>
> **Use at your own risk.** Keep usage limited to personal, interactive sessions and avoid any automation.

![SC1_Title.gif](https://github.com/user-attachments/assets/a50a1f80-39ff-4eba-8090-e3d75e7be98c)

Everytime we ask ChatGPT, we need to put so much context information for each query. Why spend time putting background infos that are already in your vault?

**Smart Composer is an Obsidian plugin that helps you write efficiently with AI by easily referencing your vault content.** Inspired by Cursor AI and ChatGPT Canvas, this plugin unifies your note-taking and content creation process within Obsidian.

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

Smart Composer **suggests edits to your document.** You can apply with a single click.

- Offers document change recommendations
- Apply suggested changes instantly

### Vault Search (RAG)

![SC4_RAG-ezgif.com-crop-video.gif](https://github.com/user-attachments/assets/91c3ab8d-56d7-43b8-bb4a-1e73615a40ec)

**Automatically find and use relevant notes** from your vault to enhance AI responses.

- Hit `Cmd+Shift+Enter` to run Vault Search answer
- Semantic search across your vault to find the most relevant context

### Model Context Protocol (MCP)

![mcp_demo](https://github.com/user-attachments/assets/4c80a1af-4cbf-4aa4-90d2-457499553357)

Connect Smart Composer to external MCP servers.
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
> Smart Composer requires a recent version of the Obsidian installer. If you experience issues with the plugin not loading properly:
>
> 1. First, try updating Obsidian normally at `Settings > General > Check for updates`.
>
> 2. If issues persist, manually update your Obsidian installer:
>    - Download the latest installer from [Obsidian's download page](https://obsidian.md/download)
>    - Close Obsidian completely
>    - Run the new installer

1. Open Obsidian Settings
2. Navigate to "Community plugins" and click "Browse"
3. Search for "Smart Composer" and click Install
4. Enable the plugin in Community plugins
5. Set up Smart Composer in plugin settings:
   - **Connect subscription (no API key)**: Connect your Claude/OpenAI account in `Settings > Smart Composer > Connect your subscription`
   - **API Providers (usage-based billing)**: Add an API key in `Settings > Smart Composer > Providers`
     - OpenAI: [ChatGPT API Keys](https://platform.openai.com/api-keys)
     - Anthropic: [Claude API Keys](https://console.anthropic.com/settings/keys)
     - Gemini: [Gemini API Keys](https://aistudio.google.com/apikey)

> [!TIP]
> **Looking for a free option?**
> Gemini API provides the best performance among free models for Smart Composer. Recommended for users looking for a free option.
> _When using free APIs, please review the provider’s privacy policy before sending sensitive data._

**📚 For detailed setup instructions and documentation, please visit our [Documentation](https://github.com/glowingjade/obsidian-smart-composer/wiki).**

## Roadmap

To see our up-to-date project roadmap and progress, please check out our [GitHub Projects kanban board](https://github.com/glowingjade/obsidian-smart-composer/projects?query=is%3Aopen).

Some of our planned features include:

- Support for external files (PDF, DOCX, etc.)
- Mentioning with tags or other metadata

## Feedback and Support

We value your input and want to ensure you can easily share your thoughts and report any issues:

- **Bug Reports**: If you encounter any bugs or unexpected behavior, please submit an issue on our [GitHub Issues](https://github.com/glowingjade/obsidian-smart-composer/issues) page. Be sure to include as much detail as possible to help us reproduce and address the problem.

- **Feature Requests**: For new feature ideas or enhancements, please use our [GitHub Discussions - Ideas & Feature Requests](https://github.com/glowingjade/obsidian-smart-composer/discussions/categories/ideas-feature-requests) page. Create a new discussion to share your suggestions. This allows for community engagement and helps us prioritize future developments.

- **Show and Tell**: We love seeing how you use Smart Composer! Share your unique use cases, workflows, or interesting applications of the plugin in the [GitHub Discussions - Smart Composer Showcase](https://github.com/glowingjade/obsidian-smart-composer/discussions/categories/smart-composer-showcase) page.

Your feedback and experiences are crucial in making Smart Composer better for everyone!

## Contributing

We welcome all kinds of contributions to Smart Composer, including bug reports, bug fixes, documentation improvements, and feature enhancements.

**For major feature ideas, please create an issue first to discuss feasibility and implementation approach.**

If you're interested in contributing, please refer to our [CONTRIBUTING.md](CONTRIBUTING.md) file for detailed information on:

- Setting up the development environment
- Our development workflow
- Working with the database schema
- The process for submitting pull requests
- Known issues and solutions for developers


## Contributors

### Core Team

These contributors were instrumental in shaping the initial vision, architecture, and design of Smart Composer:

**[@glowingjade](https://github.com/glowingjade)** ([Twitter](https://x.com/andy_suh_)), **[@kevin-on](https://github.com/kevin-on)**, **[@realsnoopso](https://github.com/realsnoopso)** ([Twitter](https://twitter.com/RealSnoopSo) · [LinkedIn](https://linkedin.com/in/realsnoopso)), **[@woosukji](https://github.com/woosukji)**

### Additional Contributors

We also want to thank everyone else who has contributed. Your time and effort help make Smart Composer better for everyone!

## License

This project is licensed under the [MIT License](LICENSE).

## Support the Project

If you find Smart Composer valuable, consider supporting its development:

<a href="https://www.buymeacoffee.com/kevin.on" target="_blank">
  <img src="https://github.com/user-attachments/assets/e794767d-b7dd-40eb-9132-e48ae7088000" alt="Buy Me A Coffee" width="180">
</a>

Follow me on X (Twitter) [@andy_suh_](https://x.com/andy_suh_) for updates and announcements!

Your support helps maintain and improve this plugin. Every contribution is appreciated and makes a difference. Thank you for your support!

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=glowingjade/obsidian-smart-composer&type=Date)](https://star-history.com/#glowingjade/obsidian-smart-composer&Date)
