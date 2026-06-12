export const App = jest.fn()
export const Editor = jest.fn()
export const MarkdownView = jest.fn()
export class Modal {
  modalEl = {
    style: {},
  }

  constructor() {
    this.modalEl = {
      style: {},
    }
  }

  open() {}
  close() {}
  onOpen() {}
  onClose() {}
}
export const Notice = jest.fn()
export const Platform = {
  isDesktop: true,
}
export class Plugin {
  app: unknown

  constructor(app?: unknown) {
    this.app = app
  }
}
export const TFile = jest.fn()
export const TFolder = jest.fn()
export const Vault = jest.fn()
export const normalizePath = jest.fn((path: string) => path)
