// src/core/agents/Agent.class.ts

import type { Agent as AgentInterface, AgentMemory, AgentPlan } from '../types';

export class Agent implements AgentInterface {
  id: string;
  name: string;
  description: string;
  memory: AgentMemory;
  plan: AgentPlan;
  status: string;
  position: { x: number; y: number };

  constructor(id: string, name: string, description: string) {
    this.id = id;
    this.name = name;
    this.description = description;
    this.memory = { shortTerm: [], longTerm: [] };
    this.plan = { dailySchedule: [] };
    this.status = 'idle';
    this.position = { x: 0, y: 0 };
  }

  // Core think loop will be implemented here
  think() {
    // 1. Perceive
    // 2. Plan
    // 3. Reflect
    // 4. Act
    console.log(`${this.name} is thinking...`);
  }
}
