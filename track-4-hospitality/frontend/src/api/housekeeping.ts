import { getJson, postJson, putJson } from './client'
import type {
  FloorAssignment,
  FloorAssignmentInput,
  BoardRoom,
  HousekeepingBoard,
  LateRoom,
  OutOfOrderRequest,
  ReadyBy,
  RoomTransitionRequest,
} from './types'

export const getHousekeepingBoard = (hotelId: number) =>
  getJson<HousekeepingBoard>(`/api/hotels/${hotelId}/board`)

export const getLateRooms = (hotelId: number) =>
  getJson<LateRoom[]>(`/api/hotels/${hotelId}/late-rooms`)

export const getFloorAssignments = (hotelId: number) =>
  getJson<FloorAssignment[]>(`/api/hotels/${hotelId}/floor-assignments`)

export const replaceFloorAssignments = (hotelId: number, assignments: FloorAssignmentInput[]) =>
  putJson<FloorAssignment[]>(`/api/hotels/${hotelId}/floor-assignments`, { assignments })

export const getReadyBy = (roomId: number) =>
  getJson<ReadyBy>(`/api/rooms/${roomId}/ready-by`)

export const transitionRoom = (roomId: number, request: RoomTransitionRequest) =>
  postJson<BoardRoom>(`/api/rooms/${roomId}/transitions`, request)

export const markRoomOutOfOrder = (roomId: number, request: OutOfOrderRequest) =>
  postJson<BoardRoom>(`/api/rooms/${roomId}/out-of-order`, request)
