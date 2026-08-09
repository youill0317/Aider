import { App } from 'obsidian'

import SmartComposerPlugin from '../../main'
import { ObsidianButton } from '../common/ObsidianButton'
import { ObsidianSetting } from '../common/ObsidianSetting'

import { ChatSection } from './sections/ChatSection'
import { CodexToolSection } from './sections/CodexToolSection'
import { MaintenanceSection } from './sections/MaintenanceSection'
import { McpSection } from './sections/McpSection'
import { ChatModelsSubSection } from './sections/models/ChatModelsSubSection'
import { EmbeddingModelsSubSection } from './sections/models/EmbeddingModelsSubSection'
import { PlanConnectionsSection } from './sections/PlanConnectionsSection'
import { ProvidersSection } from './sections/ProvidersSection'
import { RAGSection } from './sections/RAGSection'
import { TemplateSection } from './sections/TemplateSection'

type SettingsTabRootProps = {
  app: App
  plugin: SmartComposerPlugin
}

export function SettingsTabRoot({ app, plugin }: SettingsTabRootProps) {
  return (
    <>
      <PlanConnectionsSection app={app} plugin={plugin} />
      <ChatSection />
      <CodexToolSection />
      <ProvidersSection app={app} plugin={plugin} />
      <ChatModelsSubSection app={app} plugin={plugin} />
      <EmbeddingModelsSubSection app={app} plugin={plugin} />
      <RAGSection app={app} plugin={plugin} />
      <McpSection app={app} plugin={plugin} />
      <TemplateSection app={app} />
      <MaintenanceSection app={app} plugin={plugin} />
      <div className="smtcmp-settings-section">
        <h2 className="smtcmp-settings-header">About</h2>
        <ObsidianSetting
          name="Support Aider"
          desc="If you find Aider valuable, consider supporting its development!"
        >
          <ObsidianButton
            text="Open repository"
            onClick={() =>
              window.open(
                'https://github.com/youill0317/Aider',
                '_blank',
                'noopener,noreferrer',
              )
            }
          />
        </ObsidianSetting>
      </div>
    </>
  )
}
