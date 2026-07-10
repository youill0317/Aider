import { Tiktoken } from 'js-tiktoken/lite'
import * as cl100kBaseModule from 'js-tiktoken/ranks/cl100k_base'

let encoder: Tiktoken | null = null

function getEncoder(): Tiktoken {
  encoder ??= new Tiktoken(cl100kBaseModule.default ?? cl100kBaseModule)
  return encoder
}

export async function tokenCount(text: string): Promise<number> {
  return getEncoder().encode(text).length
}
