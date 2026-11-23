// Plan aggregate: the planner's writes (meals and slots). The planner's reads come from usePantry (pantry.ts).
import { defineCommand } from './command.ts'
import { keys } from './keys.ts'
import type { PlannedMealInput } from './port.ts'

export type { PlannedMealInput }

// Every planner write refreshes the pantry: it is the one query the planner reads from.
const refreshPlanner = () => [keys.pantry.all()]

export const addMeal = defineCommand<PlannedMealInput>({
  name: 'plan.add',
  run: (api, row) => api.plan.add(row),
  invalidates: refreshPlanner,
})

export const moveMeal = defineCommand<{ id: string; to: { date: string; slot: string; position: number } }>({
  name: 'plan.move',
  run: (api, { id, to }) => api.plan.move(id, to),
  invalidates: refreshPlanner,
})

export const setMealPortions = defineCommand<{ id: string; portions: number }>({
  name: 'plan.setPortions',
  run: (api, { id, portions }) => api.plan.setPortions(id, portions),
  invalidates: refreshPlanner,
})

export const setMealCook = defineCommand<{ id: string; cookId: string | null }>({
  name: 'plan.setCook',
  run: (api, { id, cookId }) => api.plan.setCook(id, cookId),
  invalidates: refreshPlanner,
})

export const deleteMeal = defineCommand<{ id: string }>({
  name: 'plan.delete',
  run: (api, { id }) => api.trash.softDelete('planned_meals', [id]),
  invalidates: refreshPlanner,
})
