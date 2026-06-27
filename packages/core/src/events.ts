import { EventEmitter } from 'node:events'
import type { TaskStatus, TaskRunRecord } from './types.js'

export interface SentinelEventMap {
  'task:status-changed': { name: string; status: TaskStatus }
  'task:run-started': { name: string; record: TaskRunRecord }
  'task:run-completed': { name: string; record: TaskRunRecord }
  'scheduler:log': { level: string; msg: string }
  'scheduler:started': undefined
  'scheduler:stopped': undefined
}

class SentinelEventEmitter extends EventEmitter {
  emit<K extends keyof SentinelEventMap>(event: K, ...args: SentinelEventMap[K] extends undefined ? [] : [SentinelEventMap[K]]): boolean {
    return super.emit(event, ...args)
  }

  on<K extends keyof SentinelEventMap>(event: K, listener: SentinelEventMap[K] extends undefined
    ? () => void
    : (data: SentinelEventMap[K]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void)
  }

  off<K extends keyof SentinelEventMap>(event: K, listener: SentinelEventMap[K] extends undefined
    ? () => void
    : (data: SentinelEventMap[K]) => void): this {
    return super.off(event, listener as (...args: unknown[]) => void)
  }

  once<K extends keyof SentinelEventMap>(event: K, listener: SentinelEventMap[K] extends undefined
    ? () => void
    : (data: SentinelEventMap[K]) => void): this {
    return super.once(event, listener as (...args: unknown[]) => void)
  }
}

/** Global event bus for Sentinel core events */
export const sentinelEvents = new SentinelEventEmitter()
