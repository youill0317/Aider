import { Edit, Trash2 } from 'lucide-react'
import { App, Notice } from 'obsidian'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { TemplateManager } from '../../../database/json/template/TemplateManager'
import { TemplateMetadata } from '../../../database/json/template/types'
import { ConfirmModal } from '../../modals/ConfirmModal'
import {
  CreateTemplateModal,
  EditTemplateModal,
} from '../../modals/TemplateFormModal'

type TemplateSectionProps = {
  app: App
}

export function TemplateSection({ app }: TemplateSectionProps) {
  const templateManager = useMemo(() => new TemplateManager(app), [app])

  const [templateList, setTemplateList] = useState<TemplateMetadata[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const fetchTemplateList = useCallback(async () => {
    setIsLoading(true)
    try {
      setTemplateList(await templateManager.listMetadata())
    } catch (error) {
      console.error('Failed to fetch template list:', error)
      new Notice(
        'Failed to load templates. Please try refreshing the settings.',
      )
      setTemplateList([])
    } finally {
      setIsLoading(false)
    }
  }, [templateManager])

  const handleCreate = useCallback(() => {
    new CreateTemplateModal({
      app,
      selectedSerializedNodes: null,
      onSubmit: fetchTemplateList,
    }).open()
  }, [fetchTemplateList, app])

  const handleEdit = useCallback(
    (template: TemplateMetadata) => {
      new EditTemplateModal({
        app,
        templateId: template.id,
        onSubmit: fetchTemplateList,
      }).open()
    },
    [fetchTemplateList, app],
  )

  const handleDelete = useCallback(
    (template: TemplateMetadata) => {
      const message = `Are you sure you want to delete template "${template.name}"?`
      new ConfirmModal(app, {
        title: 'Delete template',
        message: message,
        ctaText: 'Delete',
        onConfirm: async () => {
          try {
            await templateManager.deleteTemplate(template.id)
            fetchTemplateList()
          } catch (error) {
            console.error('Failed to delete template:', error)
            throw new Error('Failed to delete template. Please try again.')
          }
        },
      }).open()
    },
    [templateManager, fetchTemplateList, app],
  )

  useEffect(() => {
    fetchTemplateList()
  }, [fetchTemplateList])

  return (
    <div className="smtcmp-settings-section">
      <h2 className="smtcmp-settings-header">Prompt templates</h2>

      <div className="smtcmp-settings-desc smtcmp-settings-callout">
        <strong>How to use:</strong> Create templates with reusable content that
        you can quickly insert into your chat. Type <code>/template-name</code>{' '}
        in the chat input to trigger template insertion. You can also drag and
        select text in the chat input to reveal a &quot;Create template&quot;
        button for quick template creation.
      </div>

      <h3 className="smtcmp-settings-sub-header">Saved templates</h3>

      <div className="smtcmp-settings-table-container">
        <table className="smtcmp-settings-table">
          <colgroup>
            <col />
            <col width={60} />
          </colgroup>
          <thead>
            <tr>
              <th>Name</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={2} className="smtcmp-settings-table-empty">
                  Loading templates...
                </td>
              </tr>
            ) : templateList.length > 0 ? (
              templateList.map((template) => (
                <tr key={template.id}>
                  <td>{template.name}</td>
                  <td>
                    <div className="smtcmp-settings-actions">
                      <button
                        type="button"
                        className="clickable-icon"
                        aria-label={`Edit template ${template.name}`}
                        onClick={() => {
                          handleEdit(template)
                        }}
                      >
                        <Edit />
                      </button>
                      <button
                        type="button"
                        className="clickable-icon"
                        aria-label={`Delete template ${template.name}`}
                        onClick={() => {
                          handleDelete(template)
                        }}
                      >
                        <Trash2 />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={2} className="smtcmp-settings-table-empty">
                  No templates found
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>
                <button type="button" onClick={handleCreate}>
                  Add prompt template
                </button>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
