// CORS and JSON replies for the edge functions.
//
// Kept out of push.ts on purpose: delete-account only needs these two helpers, and importing push.ts would pull
// web-push, the pantry replay and the whole push stack into its bundle (and its deploy).
export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
