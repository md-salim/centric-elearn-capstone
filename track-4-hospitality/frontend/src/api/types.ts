export interface Hotel {
  id: number
  code: string
  name: string
  city: string
  region: string
  addressLine: string
  phone: string
  active: boolean
}

export interface RoomType {
  id: number
  code: string
  name: string
  maxOccupancy: number
  baseRate: number
  slaMinutes: number
}

export interface BoardRoom {
  roomId: number
  roomNumber: string
  roomType: string
  status: string
  selfMarked: boolean
  checkedOutAt: string | null
  dueAt: string | null
  minutesOver: number | null
  oooReason: string | null
}

export interface BoardFloor {
  floor: number
  housekeeper: { id: number; displayName: string } | null
  rooms: BoardRoom[]
}

export interface HousekeepingBoard {
  hotelId: number
  generatedAt: string
  floors: BoardFloor[]
}

export interface LateRoom {
  roomId: number
  roomNumber: string
  floor: number
  roomType: string
  status: string
  checkedOutAt: string
  dueAt: string
  minutesOver: number
}

export interface FloorAssignment {
  floor: number
  housekeeperId: number
  displayName: string
}

export interface FloorAssignmentInput {
  floor: number
  housekeeperId: number
}

export interface StaffUser {
  id: number
  displayName: string
  role: string
  hotelId: number | null
  active: boolean
}

export interface ReadyBy {
  roomId: number
  state: string
  readyBy: string | null
  expectedReturnAt: string | null
  estimatedReadyAt: string | null
  basedOn: string
}

export interface RoomTransitionRequest {
  to: string
  reason?: string
  expectedReturnAt?: string
}

export interface OutOfOrderRequest {
  reason: string
  until?: string
}

export interface Paged<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
}

export interface Booking {
  id: number
  reference: string
  channel: string
  hotelName: string
  guestName: string
  roomTypeName: string
  roomNumber: string | null
  checkIn: string
  checkOut: string
  nights: number
  status: string
  totalAmount: number
}

export interface Guest {
  id: number
  firstName: string
  lastName: string
  email: string
  phone: string
  city: string
  region: string
  loyaltyTier: string
}

export interface OccupancyReport {
  hotelId: number | null
  from: string
  to: string
  roomsAvailable: number
  roomNightsSold: number
  occupancyPct: number
  days: { date: string; roomsSold: number }[]
}
