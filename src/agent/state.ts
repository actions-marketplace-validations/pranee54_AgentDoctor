/**
 * Explicit agent state machine for Project AI Agent (2.1 M1).
 * Transitions are audited; illegal transitions throw.
 */

export enum AgentState {
  IDLE = "IDLE",
  UNDERSTANDING = "UNDERSTANDING",
  PLANNING = "PLANNING",
  WAITING_FOR_APPROVAL = "WAITING_FOR_APPROVAL",
  EXECUTING = "EXECUTING",
  VERIFYING = "VERIFYING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
}

const ALLOWED: Record<AgentState, readonly AgentState[]> = {
  [AgentState.IDLE]: [AgentState.UNDERSTANDING, AgentState.CANCELLED],
  [AgentState.UNDERSTANDING]: [
    AgentState.PLANNING,
    AgentState.EXECUTING,
    AgentState.FAILED,
    AgentState.CANCELLED,
  ],
  [AgentState.PLANNING]: [
    AgentState.WAITING_FOR_APPROVAL,
    AgentState.EXECUTING,
    AgentState.FAILED,
    AgentState.CANCELLED,
  ],
  [AgentState.WAITING_FOR_APPROVAL]: [
    AgentState.EXECUTING,
    AgentState.CANCELLED,
    AgentState.FAILED,
  ],
  [AgentState.EXECUTING]: [
    AgentState.VERIFYING,
    AgentState.PLANNING,
    AgentState.EXECUTING,
    AgentState.FAILED,
    AgentState.CANCELLED,
  ],
  [AgentState.VERIFYING]: [
    AgentState.COMPLETED,
    AgentState.EXECUTING,
    AgentState.FAILED,
    AgentState.CANCELLED,
  ],
  [AgentState.COMPLETED]: [AgentState.IDLE],
  [AgentState.FAILED]: [AgentState.IDLE],
  [AgentState.CANCELLED]: [AgentState.IDLE],
};

export interface AgentStateTransition {
  from: AgentState;
  to: AgentState;
  at: string;
  reason?: string;
}

export class AgentStateMachine {
  private _state: AgentState = AgentState.IDLE;
  private readonly _history: AgentStateTransition[] = [];

  get state(): AgentState {
    return this._state;
  }

  get history(): readonly AgentStateTransition[] {
    return this._history;
  }

  canTransition(to: AgentState): boolean {
    return ALLOWED[this._state].includes(to);
  }

  transition(to: AgentState, reason?: string): AgentStateTransition {
    if (!this.canTransition(to)) {
      throw new Error(`Illegal agent state transition: ${this._state} → ${to}`);
    }
    const entry: AgentStateTransition = {
      from: this._state,
      to,
      at: new Date().toISOString(),
      ...(reason !== undefined ? { reason } : {}),
    };
    this._state = to;
    this._history.push(entry);
    return entry;
  }

  reset(): void {
    if (this._state !== AgentState.IDLE) {
      if (this.canTransition(AgentState.IDLE)) {
        this.transition(AgentState.IDLE, "reset");
      } else {
        this._state = AgentState.IDLE;
        this._history.push({
          from: this._history.at(-1)?.to ?? AgentState.IDLE,
          to: AgentState.IDLE,
          at: new Date().toISOString(),
          reason: "force-reset",
        });
      }
    }
  }
}
