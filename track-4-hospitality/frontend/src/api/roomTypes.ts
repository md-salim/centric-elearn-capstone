import { getJson } from './client'
import type { RoomType } from './types'

export const listRoomTypes = () => getJson<RoomType[]>('/api/room-types')
