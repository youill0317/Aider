import { App } from 'obsidian'

import { MAX_JSON_FILE_NAME_BYTES } from '../file-name'

import { TemplateManager } from './TemplateManager'
import { TEMPLATE_SCHEMA_VERSION, Template } from './types'

const mockAdapter = {
  exists: jest.fn().mockResolvedValue(true),
  mkdir: jest.fn().mockResolvedValue(undefined),
  read: jest.fn().mockResolvedValue(''),
  write: jest.fn().mockResolvedValue(undefined),
  rename: jest.fn().mockResolvedValue(undefined),
  remove: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn().mockResolvedValue({ type: 'file', size: 1 }),
  list: jest.fn().mockResolvedValue({ files: [], folders: [] }),
}

const mockVault = {
  adapter: mockAdapter,
}

const mockApp = {
  vault: mockVault,
} as unknown as App

describe('TemplateManager', () => {
  let templateManager: TemplateManager

  beforeEach(() => {
    jest.clearAllMocks()
    mockAdapter.exists.mockResolvedValue(true)
    mockAdapter.list.mockResolvedValue({ files: [], folders: [] })
    mockAdapter.read.mockResolvedValue('')
    templateManager = new TemplateManager(mockApp)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('filename generation and parsing roundtrip', () => {
    const testNames = [
      'Simple Name',
      'Special & Characters! #$%^',
      '**Markdown name**',
      'Unicode 中文 日本語 한국어',
      'Extremely long name that might cause issues with file systems',
      'Name with trailing spaces   ',
      '   Name with leading spaces',
      'Name with _ underscores_and_special_chars',
      'Name with.dots.and-dashes',
      'Name with / slashes \\ and \\ backslashes',
      'Name with "quotes" and \'apostrophes\'',
      'Name with <html> tags',
      'Name with newlines\nand\ttabs',
      '🔥 Name with emojis 🚀',
      ' ',
      'Name-with-123e4567-e89b-12d3-a456-426614174000-uuid-like-substring',
      '_Name_starting_with_underscore',
      'Name+with+plus+signs',
      'Name%20with%20encoded%20characters',
      'Name ending with .json',
      'v1_Name_starting_like_a_versioned_file',
      '..Name with leading dots',
      'Name with trailing dots..',
    ]

    test.each(testNames)('should correctly roundtrip name: %s', (name) => {
      const template: Template = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name,
        content: { nodes: [{ type: 'text', version: 1 }] },
        createdAt: 1620000000000,
        updatedAt: 1620000000000,
        schemaVersion: TEMPLATE_SCHEMA_VERSION,
      }

      const fileName = (
        templateManager as unknown as {
          generateFileName: (template: Template) => string
        }
      ).generateFileName(template)
      const metadata = (
        templateManager as unknown as {
          parseFileName: (
            fileName: string,
          ) => { id: string; name: string; schemaVersion: number } | null
        }
      ).parseFileName(fileName)

      expect(metadata).not.toBeNull()
      if (metadata) {
        expect(metadata.id).toBe(template.id)
        expect(metadata.name).toBe(template.name)
        expect(metadata.schemaVersion).toBe(template.schemaVersion)
      }
    })
  })

  it('encodes Windows-reserved asterisks in generated filenames', () => {
    const template: Template = {
      id: '123e4567-e89b-42d3-a456-426614174000',
      name: '**Markdown name**',
      content: { nodes: [{ type: 'text', version: 1 }] },
      createdAt: 1,
      updatedAt: 1,
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
    }
    const fileMethods = templateManager as unknown as {
      generateFileName: (value: Template) => string
      parseFileName: (value: string) => { name: string } | null
    }
    const fileName = fileMethods.generateFileName(template)

    expect(fileName).not.toContain('*')
    expect(fileMethods.parseFileName(fileName)?.name).toBe(template.name)
  })

  it('removes the actual pre-encoding filename when updating a template', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(20)
    const id = '123e4567-e89b-42d3-a456-426614174000'
    const template: Template = {
      id,
      name: 'Foo*Bar',
      content: { nodes: [{ type: 'text', version: 1 }] },
      createdAt: 1,
      updatedAt: 10,
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
    }
    const legacyFileName = `v${TEMPLATE_SCHEMA_VERSION}_Foo*Bar_${id}.json`
    const legacyPath = `.aider_json_db/templates/${legacyFileName}`
    mockAdapter.list.mockResolvedValue({ files: [legacyPath], folders: [] })
    mockAdapter.read.mockResolvedValue(JSON.stringify(template))
    mockAdapter.exists.mockImplementation(
      async (path: string) =>
        path.endsWith('/templates') || path === legacyPath,
    )

    await expect(
      templateManager.updateTemplate(id, {
        content: { nodes: [{ type: 'text', version: 1 }] },
      }),
    ).resolves.toMatchObject({ updatedAt: 20 })

    expect(mockAdapter.remove).toHaveBeenCalledWith(legacyPath)
    expect(mockAdapter.rename).toHaveBeenCalledWith(
      expect.stringMatching(/\.aider-.*\.tmp$/),
      expect.stringContaining('Foo%2ABar'),
    )
  })

  it.each([
    ['Korean', '한'.repeat(50)],
    ['emoji', '🔥'.repeat(50)],
  ])('bounds a long %s name without splitting Unicode', async (_case, name) => {
    mockAdapter.exists.mockImplementation(async (filePath: string) =>
      filePath.endsWith('/templates'),
    )

    const template = await templateManager.createTemplate({
      name,
      content: { nodes: [{ type: 'text', version: 1 }] },
    })
    const storedTemplate = JSON.parse(
      String(mockAdapter.write.mock.calls[0][1]),
    )
    const temporaryName = String(mockAdapter.write.mock.calls[0][0])
      .split('/')
      .pop()
    const fileName = String(mockAdapter.rename.mock.calls[0][1])
      .split('/')
      .pop()
    const metadata = (
      templateManager as unknown as {
        parseFileName: (value: string) => { name: string } | null
      }
    ).parseFileName(fileName ?? '')

    expect(fileName?.length).toBeLessThanOrEqual(MAX_JSON_FILE_NAME_BYTES)
    expect(temporaryName?.length).toBeLessThan(255)
    expect(template.name).toBe(name)
    expect(() => encodeURIComponent(template.name)).not.toThrow()
    expect(storedTemplate.name).toBe(name)
    expect(metadata?.name.length).toBeLessThan(name.length)
    expect(name.startsWith(metadata?.name ?? '')).toBe(true)

    mockAdapter.exists.mockResolvedValue(true)
    mockAdapter.list.mockResolvedValue({
      files: [`.aider_json_db/templates/${fileName ?? ''}`],
      folders: [],
    })
    mockAdapter.read.mockResolvedValue(JSON.stringify(template))
    await expect(templateManager.findById(template.id)).resolves.toEqual(
      template,
    )
    await expect(templateManager.findByName(name)).resolves.toEqual(template)
  })

  it('searches the full name beyond its truncated filename label', async () => {
    const id = '123e4567-e89b-42d3-a456-426614174000'
    const name = `${'한'.repeat(80)} distinctive-suffix`
    const template: Template = {
      id,
      name,
      content: { nodes: [{ type: 'text', version: 1 }] },
      createdAt: 1,
      updatedAt: 1,
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
    }
    const fileMethods = templateManager as unknown as {
      generateFileName: (value: Template) => string
      parseFileName: (value: string) => { name: string } | null
    }
    const fileName = fileMethods.generateFileName(template)
    mockAdapter.list.mockResolvedValue({
      files: [`.aider_json_db/templates/${fileName}`],
      folders: [],
    })
    mockAdapter.read.mockResolvedValue(JSON.stringify(template))

    expect(fileMethods.parseFileName(fileName)?.name).not.toContain(
      'distinctive-suffix',
    )
    await expect(
      templateManager.searchTemplates('distinctive-suffix'),
    ).resolves.toEqual([template])
  })

  it('loads a legacy filename longer than the current filename limit', async () => {
    const id = '123e4567-e89b-42d3-a456-426614174000'
    const name = 'L'.repeat(180)
    const template: Template = {
      id,
      name,
      content: { nodes: [{ type: 'text', version: 1 }] },
      createdAt: 1,
      updatedAt: 1,
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
    }
    const legacyFileName = `v${TEMPLATE_SCHEMA_VERSION}_${encodeURIComponent(
      name,
    )}_${id}.json`
    expect(legacyFileName.length).toBeGreaterThan(MAX_JSON_FILE_NAME_BYTES)
    expect(legacyFileName.length).toBeLessThan(255)
    mockAdapter.list.mockResolvedValue({
      files: [`.aider_json_db/templates/${legacyFileName}`],
      folders: [],
    })
    mockAdapter.read.mockResolvedValue(JSON.stringify(template))

    await expect(templateManager.findByName(name)).resolves.toEqual(template)
    await expect(templateManager.listTemplates()).resolves.toEqual([template])
  })

  it.each([
    ['old first', ['old', 'new']],
    ['new first', ['new', 'old']],
  ])(
    'prefers the newest valid duplicate and deletes every copy with %s',
    async (_case, order) => {
      const id = '123e4567-e89b-42d3-a456-426614174000'
      const oldTemplate: Template = {
        id,
        name: 'Old',
        content: { nodes: [{ type: 'text', version: 1 }] },
        createdAt: 1,
        updatedAt: 10,
        schemaVersion: TEMPLATE_SCHEMA_VERSION,
      }
      const newTemplate = { ...oldTemplate, name: 'New', updatedAt: 20 }
      const fileMethods = templateManager as unknown as {
        generateFileName: (value: Template) => string
      }
      const fileNames = {
        old: fileMethods.generateFileName(oldTemplate),
        new: fileMethods.generateFileName(newTemplate),
      }
      const filePaths = order.map(
        (key) => `.aider_json_db/templates/${fileNames[key as 'old' | 'new']}`,
      )
      mockAdapter.list.mockResolvedValue({ files: filePaths, folders: [] })
      mockAdapter.read.mockImplementation(async (filePath: string) =>
        JSON.stringify(
          filePath.endsWith(fileNames.new) ? newTemplate : oldTemplate,
        ),
      )

      await expect(templateManager.findById(id)).resolves.toEqual(newTemplate)
      await expect(templateManager.findByName('New')).resolves.toEqual(
        newTemplate,
      )
      await expect(templateManager.deleteTemplate(id)).resolves.toBe(true)
      expect(
        mockAdapter.remove.mock.calls
          .map(([filePath]) => String(filePath))
          .sort(),
      ).toEqual([...filePaths].sort())
    },
  )

  it('skips a newer duplicate whose authoritative metadata disagrees with its row', async () => {
    const id = '123e4567-e89b-42d3-a456-426614174000'
    const oldTemplate: Template = {
      id,
      name: 'Old',
      content: { nodes: [{ type: 'text', version: 1 }] },
      createdAt: 1,
      updatedAt: 10,
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
    }
    const mismatchedTemplate: Template = {
      ...oldTemplate,
      id: '223e4567-e89b-42d3-a456-426614174000',
      name: 'New',
      updatedAt: 20,
    }
    const oldFileName = `v${TEMPLATE_SCHEMA_VERSION}_Old_${id}.json`
    const newFileName = `v${TEMPLATE_SCHEMA_VERSION}_New_${id}.json`
    mockAdapter.list.mockResolvedValue({
      files: [
        `.aider_json_db/templates/${newFileName}`,
        `.aider_json_db/templates/${oldFileName}`,
      ],
      folders: [],
    })
    mockAdapter.read.mockImplementation(async (filePath: string) =>
      JSON.stringify(
        filePath.endsWith(newFileName) ? mismatchedTemplate : oldTemplate,
      ),
    )

    await expect(templateManager.findById(id)).resolves.toEqual(oldTemplate)
  })

  it('deletes parseable copies even when their rows are invalid', async () => {
    const id = '123e4567-e89b-42d3-a456-426614174000'
    const fileName = `v${TEMPLATE_SCHEMA_VERSION}_Broken_${id}.json`
    const filePath = `.aider_json_db/templates/${fileName}`
    mockAdapter.list.mockResolvedValue({ files: [filePath], folders: [] })
    mockAdapter.read.mockResolvedValue('{broken')

    await expect(templateManager.deleteTemplate(id)).resolves.toBe(true)
    expect(mockAdapter.remove).toHaveBeenCalledWith(filePath)
  })

  it('validates template files sequentially', async () => {
    const templates: Template[] = [
      {
        id: '123e4567-e89b-42d3-a456-426614174000',
        name: 'First',
        content: { nodes: [{ type: 'text', version: 1 }] },
        createdAt: 1,
        updatedAt: 1,
        schemaVersion: TEMPLATE_SCHEMA_VERSION,
      },
      {
        id: '223e4567-e89b-42d3-a456-426614174000',
        name: 'Second',
        content: { nodes: [{ type: 'text', version: 1 }] },
        createdAt: 2,
        updatedAt: 2,
        schemaVersion: TEMPLATE_SCHEMA_VERSION,
      },
    ]
    const fileMethods = templateManager as unknown as {
      generateFileName: (value: Template) => string
    }
    const fileNames = templates.map((template) =>
      fileMethods.generateFileName(template),
    )
    mockAdapter.list.mockResolvedValue({
      files: fileNames.map(
        (fileName) => `.aider_json_db/templates/${fileName}`,
      ),
      folders: [],
    })
    let activeReads = 0
    let maximumActiveReads = 0
    mockAdapter.read.mockImplementation(async (filePath: string) => {
      activeReads += 1
      maximumActiveReads = Math.max(maximumActiveReads, activeReads)
      await Promise.resolve()
      activeReads -= 1
      return JSON.stringify(templates[filePath.endsWith(fileNames[0]) ? 0 : 1])
    })

    await templateManager.searchTemplates('')
    expect(maximumActiveReads).toBe(1)
  })

  it('does not allow runtime input to replace generated fields', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1620000000000)
    mockAdapter.exists.mockImplementation(async (filePath: string) =>
      filePath.endsWith('/templates'),
    )
    const injectedId = '123e4567-e89b-42d3-a456-426614174000'
    const injected = {
      id: injectedId,
      name: 'Template',
      content: { nodes: [{ type: 'text', version: 1 }] },
      createdAt: 1,
      updatedAt: 2,
      schemaVersion: 999,
    } as Parameters<TemplateManager['createTemplate']>[0]

    const template = await templateManager.createTemplate(injected)

    expect(template.id).not.toBe(injectedId)
    expect(template.createdAt).toBe(1620000000000)
    expect(template.updatedAt).toBe(1620000000000)
    expect(template.schemaVersion).toBe(TEMPLATE_SCHEMA_VERSION)
    expect(JSON.parse(String(mockAdapter.write.mock.calls[0][1]))).toEqual(
      template,
    )
  })

  it.each([
    ['invalid node collection', { nodes: 'not-an-array' }],
    ['invalid nested node', { nodes: [null] }],
  ])('ignores template JSON with %s', async (_case, content) => {
    mockAdapter.read.mockResolvedValue(
      JSON.stringify({
        id: '123e4567-e89b-42d3-a456-426614174000',
        name: 'Broken template',
        content,
        createdAt: 1,
        updatedAt: 1,
        schemaVersion: TEMPLATE_SCHEMA_VERSION,
      }),
    )

    await expect(templateManager.read('template.json')).resolves.toBeNull()
  })

  it('rejects empty template content before writing', async () => {
    await expect(
      templateManager.createTemplate({
        name: 'Empty',
        content: { nodes: [] },
      }),
    ).rejects.toThrow('Template content cannot be empty')
    expect(mockAdapter.write).not.toHaveBeenCalled()
  })

  it('serializes template mutations', async () => {
    mockAdapter.exists.mockImplementation(async (filePath: string) =>
      filePath.endsWith('/templates'),
    )
    let activeLookups = 0
    let maximumActiveLookups = 0
    jest.spyOn(templateManager, 'findByName').mockImplementation(async () => {
      activeLookups += 1
      maximumActiveLookups = Math.max(maximumActiveLookups, activeLookups)
      await Promise.resolve()
      activeLookups -= 1
      return null
    })
    const content = { nodes: [{ type: 'text', version: 1 }] }

    await Promise.all([
      templateManager.createTemplate({ name: 'First', content }),
      templateManager.createTemplate({ name: 'Second', content }),
    ])

    expect(maximumActiveLookups).toBe(1)
  })
})
