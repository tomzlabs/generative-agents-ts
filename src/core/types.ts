// src/core/types.ts

export interface Agent {
  id: string;
  name: string;
  description: string;
  memory: AgentMemory;
  plan: AgentPlan;
  status: string; // e.g., "wandering", "talking", "sleeping"
  position: { x: number; y: number };
  // ... other agent properties
}

export interface AgentMemory {
  shortTerm: MemoryEvent[];
  longTerm: MemoryEvent[];
  // ... other memory properties
}

export interface MemoryEvent {
  timestamp: number;
  description: string;
  importance: number;
  // ... other event properties
}

export interface AgentPlan {
  dailySchedule: PlanItem[];
  currentAction?: PlanItem;
  // ... other plan properties
}

export interface PlanItem {
  startTime: number; // as a timestamp
  duration: number; // in minutes
  description: string;
}
