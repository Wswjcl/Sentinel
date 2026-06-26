import { EventEmitter } from 'node:events'
import type { TaskStatus, TaskRunRecord } from './types.js'

export interface WWCEventMap {
  'task:status-changed': { name: string; status: TaskStatus }
  'task:run-started': { name: string; record: TaskRunRecord }
  'task:run-completed': { name: string; record: TaskRunRecord }
  'scheduler:log': { level: string; msg: string }
  'scheduler:started': undefined
  'scheduler:stopped': undefined
}

class WWCEventEmitter extends EventEmitter {
  emit<K extends keyof WWCEventMap>(event: K, ...args: WWCEventMap[K] extends undefined ? [] : [WWCEventMap[K]]): boolean {
    return super.emit(event, ...args)
  }

  on<K extends keyof WWCEventMap>(event: K, listener: WWCEventMap[K] extends undefined
    ? () => void
    : (data: WWCEventMap[K]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void)
  }

  off<K extends keyof WWCEventMap>(event: K, listener: WWCEventMap[K] extends undefined
    ? () => void
    : (data: WWCEventMap[K]) => void): this {
    return super.off(event, listener as (...args: unknown[]) => void)
  }

  once<K extends keyof WWCEventMap>(event: K, listener: WWCEventMap[K] extends undefined
    ? () => void
    : (data: WWCEventMap[K]) => void): this {
    return super.once(event, listener as (...args: unknown[]) => void)
  }
}

/** Global event bus for WWC core events */
export const wwcEvents = new WWCEventEmitter()
