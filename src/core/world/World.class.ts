// src/core/world/World.class.ts
import { Agent } from '../agents/Agent.class';

export class World {
  agents: Map<string, Agent>;
  time: Date;
  tickInterval: number; // in milliseconds

  constructor(tickInterval: number = 1000) {
    this.agents = new Map();
    this.time = new Date();
    this.tickInterval = tickInterval;
  }

  addAgent(agent: Agent) {
    this.agents.set(agent.id, agent);
  }

  // The main simulation loop
  tick() {
    this.time.setSeconds(this.time.getSeconds() + 1); // Advance world time
    
    for (const agent of this.agents.values()) {
      agent.think();
    }
  }

  start() {
    setInterval(() => this.tick(), this.tickInterval);
  }
}
