import { App } from 'obsidian'

import SmartComposerPlugin from '../../../main'

import { ChatModelsSubSection } from './models/ChatModelsSubSection'
import { EmbeddingModelsSubSection } from './models/EmbeddingModelsSubSection'

type ModelsSectionProps = {
  app: App
  plugin: SmartComposerPlugin
}

export function ModelsSection({ app, plugin }: ModelsSectionProps) {
  return (
    <div className="smtcmp-settings-section">
      <h2 className="smtcmp-settings-header">Models</h2>
      <ChatModelsSubSection app={app} plugin={plugin} />
      <EmbeddingModelsSubSection app={app} plugin={plugin} />
    </div>
  )
}
