
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "adjustments": {
                  Row: {
                    "at": string,"batch_id": string | null,"created_at": string,"created_by": string | null,"deleted_at": string | null,"deleted_by": string | null,"household_id": string,"id": string,"ingredient_id": string,"kind": Database["public"]['Enums']["adjustment_kind"],"qty": number | null,"recorded_at": string,"updated_at": string | null,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "at"?: string,"batch_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"deleted_by"?: string | null,"household_id"?: string,"id"?: string,"ingredient_id": string,"kind": Database["public"]['Enums']["adjustment_kind"],"qty"?: number | null,"recorded_at"?: string,"updated_at"?: string | null,"updated_by"?: string | null
                  }
                  Update: {
                    "at"?: string,"batch_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"deleted_by"?: string | null,"household_id"?: string,"id"?: string,"ingredient_id"?: string,"kind"?: Database["public"]['Enums']["adjustment_kind"],"qty"?: number | null,"recorded_at"?: string,"updated_at"?: string | null,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "adjustments_batch_fkey"
      columns: ["household_id","batch_id"]
isOneToOne: false
      referencedRelation: "batches"
      referencedColumns: ["household_id","id"]
    },{
      foreignKeyName: "adjustments_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "adjustments_ingredient_fkey"
      columns: ["household_id","ingredient_id"]
isOneToOne: false
      referencedRelation: "ingredients"
      referencedColumns: ["household_id","id"]
    }
                  ]
                },"batches": {
                  Row: {
                    "added_at": string,"created_at": string,"created_by": string | null,"deleted_at": string | null,"deleted_by": string | null,"expires_on": string | null,"household_id": string,"id": string,"ingredient_id": string,"qty": number,"recorded_at": string,"updated_at": string | null,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "added_at"?: string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"deleted_by"?: string | null,"expires_on"?: string | null,"household_id"?: string,"id"?: string,"ingredient_id": string,"qty": number,"recorded_at"?: string,"updated_at"?: string | null,"updated_by"?: string | null
                  }
                  Update: {
                    "added_at"?: string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"deleted_by"?: string | null,"expires_on"?: string | null,"household_id"?: string,"id"?: string,"ingredient_id"?: string,"qty"?: number,"recorded_at"?: string,"updated_at"?: string | null,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "batches_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "batches_ingredient_fkey"
      columns: ["household_id","ingredient_id"]
isOneToOne: false
      referencedRelation: "ingredients"
      referencedColumns: ["household_id","id"]
    }
                  ]
                },"household_events": {
                  Row: {
                    "at": string,"by": string | null,"household_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "at"?: string,"by"?: string | null,"household_id": string
                  }
                  Update: {
                    "at"?: string,"by"?: string | null,"household_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "household_events_household_id_fkey"
      columns: ["household_id"]
isOneToOne: true
      referencedRelation: "households"
      referencedColumns: ["id"]
    }
                  ]
                },"household_members": {
                  Row: {
                    "display_name": string | null,"household_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "display_name"?: string | null,"household_id": string,"user_id": string
                  }
                  Update: {
                    "display_name"?: string | null,"household_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "household_members_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    }
                  ]
                },"households": {
                  Row: {
                    "created_at": string,"expiring_days": number,"expiry_reminder_days": number,"horizon_days": number,"id": string,"invite_code": string,"name": string,"slots": (string)[],"timezone": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"expiring_days"?: number,"expiry_reminder_days"?: number,"horizon_days"?: number,"id"?: string,"invite_code"?: string,"name": string,"slots"?: (string)[],"timezone"?: string
                  }
                  Update: {
                    "created_at"?: string,"expiring_days"?: number,"expiry_reminder_days"?: number,"horizon_days"?: number,"id"?: string,"invite_code"?: string,"name"?: string,"slots"?: (string)[],"timezone"?: string
                  }
                  Relationships: [
                    
                  ]
                },"ingredients": {
                  Row: {
                    "archived": boolean,"category": string | null,"created_at": string,"created_by": string | null,"deleted_at": string | null,"deleted_by": string | null,"household_id": string,"id": string,"min_stock": number | null,"name": string,"on_hand": boolean,"pack_size": number | null,"shelf_life_days": number | null,"unit": Database["public"]['Enums']["unit"],"updated_at": string | null,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "archived"?: boolean,"category"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"deleted_by"?: string | null,"household_id"?: string,"id"?: string,"min_stock"?: number | null,"name": string,"on_hand"?: boolean,"pack_size"?: number | null,"shelf_life_days"?: number | null,"unit": Database["public"]['Enums']["unit"],"updated_at"?: string | null,"updated_by"?: string | null
                  }
                  Update: {
                    "archived"?: boolean,"category"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"deleted_by"?: string | null,"household_id"?: string,"id"?: string,"min_stock"?: number | null,"name"?: string,"on_hand"?: boolean,"pack_size"?: number | null,"shelf_life_days"?: number | null,"unit"?: Database["public"]['Enums']["unit"],"updated_at"?: string | null,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "ingredients_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    }
                  ]
                },"planned_meals": {
                  Row: {
                    "cook_id": string | null,"created_at": string,"created_by": string | null,"date": string,"deleted_at": string | null,"deleted_by": string | null,"household_id": string,"id": string,"portions": number,"position": number,"recipe_id": string | null,"skip_shopping": boolean,"slot": string,"updated_at": string | null,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "cook_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"date": string,"deleted_at"?: string | null,"deleted_by"?: string | null,"household_id"?: string,"id"?: string,"portions": number,"position"?: number,"recipe_id"?: string | null,"skip_shopping"?: boolean,"slot": string,"updated_at"?: string | null,"updated_by"?: string | null
                  }
                  Update: {
                    "cook_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"date"?: string,"deleted_at"?: string | null,"deleted_by"?: string | null,"household_id"?: string,"id"?: string,"portions"?: number,"position"?: number,"recipe_id"?: string | null,"skip_shopping"?: boolean,"slot"?: string,"updated_at"?: string | null,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "planned_meals_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "planned_meals_recipe_fkey"
      columns: ["household_id","recipe_id"]
isOneToOne: false
      referencedRelation: "recipes"
      referencedColumns: ["household_id","id"]
    }
                  ]
                },"push_config": {
                  Row: {
                    "functions_url": string,"id": boolean,"webhook_secret": string
                  }
                  ComputedFields: never
                  Insert: {
                    "functions_url": string,"id"?: boolean,"webhook_secret": string
                  }
                  Update: {
                    "functions_url"?: string,"id"?: boolean,"webhook_secret"?: string
                  }
                  Relationships: [
                    
                  ]
                },"push_list_state": {
                  Row: {
                    "household_id": string,"known": (string)[],"window_at": string | null,"window_authors": (string)[],"window_keys": (string)[] | null
                  }
                  ComputedFields: never
                  Insert: {
                    "household_id": string,"known"?: (string)[],"window_at"?: string | null,"window_authors"?: (string)[],"window_keys"?: (string)[] | null
                  }
                  Update: {
                    "household_id"?: string,"known"?: (string)[],"window_at"?: string | null,"window_authors"?: (string)[],"window_keys"?: (string)[] | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "push_list_state_household_id_fkey"
      columns: ["household_id"]
isOneToOne: true
      referencedRelation: "households"
      referencedColumns: ["id"]
    }
                  ]
                },"push_prefs": {
                  Row: {
                    "expiry_checked_on": string | null,"expiry_time": string | null,"list_changes": boolean,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "expiry_checked_on"?: string | null,"expiry_time"?: string | null,"list_changes"?: boolean,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "expiry_checked_on"?: string | null,"expiry_time"?: string | null,"list_changes"?: boolean,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"push_subscriptions": {
                  Row: {
                    "auth": string,"created_at": string,"endpoint": string,"id": string,"p256dh": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "auth": string,"created_at"?: string,"endpoint": string,"id"?: string,"p256dh": string,"user_id"?: string
                  }
                  Update: {
                    "auth"?: string,"created_at"?: string,"endpoint"?: string,"id"?: string,"p256dh"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"recipe_ingredients": {
                  Row: {
                    "created_at": string,"created_by": string | null,"deleted_at": string | null,"deleted_by": string | null,"household_id": string,"id": string,"ingredient_id": string,"qty_per_portion": number | null,"recipe_id": string,"updated_at": string | null,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"deleted_by"?: string | null,"household_id"?: string,"id"?: string,"ingredient_id": string,"qty_per_portion"?: number | null,"recipe_id": string,"updated_at"?: string | null,"updated_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"deleted_by"?: string | null,"household_id"?: string,"id"?: string,"ingredient_id"?: string,"qty_per_portion"?: number | null,"recipe_id"?: string,"updated_at"?: string | null,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "recipe_ingredients_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "recipe_ingredients_ingredient_fkey"
      columns: ["household_id","ingredient_id"]
isOneToOne: false
      referencedRelation: "ingredients"
      referencedColumns: ["household_id","id"]
    },{
      foreignKeyName: "recipe_ingredients_recipe_fkey"
      columns: ["household_id","recipe_id"]
isOneToOne: false
      referencedRelation: "recipes"
      referencedColumns: ["household_id","id"]
    }
                  ]
                },"recipes": {
                  Row: {
                    "created_at": string,"created_by": string | null,"deleted_at": string | null,"deleted_by": string | null,"household_id": string,"id": string,"instructions": string,"name": string,"serves": number,"tags": (string)[],"updated_at": string | null,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"deleted_by"?: string | null,"household_id"?: string,"id"?: string,"instructions"?: string,"name": string,"serves"?: number,"tags"?: (string)[],"updated_at"?: string | null,"updated_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"deleted_by"?: string | null,"household_id"?: string,"id"?: string,"instructions"?: string,"name"?: string,"serves"?: number,"tags"?: (string)[],"updated_at"?: string | null,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "recipes_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    }
                  ]
                },"shopping_items": {
                  Row: {
                    "bought_batch_id": string | null,"checked": boolean,"created_at": string,"created_by": string | null,"deleted_at": string | null,"deleted_by": string | null,"household_id": string,"id": string,"ingredient_id": string | null,"qty": number | null,"text": string | null,"updated_at": string | null,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "bought_batch_id"?: string | null,"checked"?: boolean,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"deleted_by"?: string | null,"household_id"?: string,"id"?: string,"ingredient_id"?: string | null,"qty"?: number | null,"text"?: string | null,"updated_at"?: string | null,"updated_by"?: string | null
                  }
                  Update: {
                    "bought_batch_id"?: string | null,"checked"?: boolean,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"deleted_by"?: string | null,"household_id"?: string,"id"?: string,"ingredient_id"?: string | null,"qty"?: number | null,"text"?: string | null,"updated_at"?: string | null,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "shopping_items_bought_batch_fkey"
      columns: ["household_id","bought_batch_id"]
isOneToOne: false
      referencedRelation: "batches"
      referencedColumns: ["household_id","id"]
    },{
      foreignKeyName: "shopping_items_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "shopping_items_ingredient_fkey"
      columns: ["household_id","ingredient_id"]
isOneToOne: false
      referencedRelation: "ingredients"
      referencedColumns: ["household_id","id"]
    }
                  ]
                },"signup_allowlist": {
                  Row: {
                    "email": string
                  }
                  ComputedFields: never
                  Insert: {
                    "email": string
                  }
                  Update: {
                    "email"?: string
                  }
                  Relationships: [
                    
                  ]
                },"snapshot_batches": {
                  Row: {
                    "batch_id": string,"created_at": string,"created_by": string | null,"deleted_at": string | null,"deleted_by": string | null,"household_id": string,"qty": number,"snapshot_id": string,"updated_at": string | null,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "batch_id": string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"deleted_by"?: string | null,"household_id"?: string,"qty": number,"snapshot_id": string,"updated_at"?: string | null,"updated_by"?: string | null
                  }
                  Update: {
                    "batch_id"?: string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"deleted_by"?: string | null,"household_id"?: string,"qty"?: number,"snapshot_id"?: string,"updated_at"?: string | null,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "snapshot_batches_batch_fkey"
      columns: ["household_id","batch_id"]
isOneToOne: false
      referencedRelation: "batches"
      referencedColumns: ["household_id","id"]
    },{
      foreignKeyName: "snapshot_batches_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "snapshot_batches_snapshot_fkey"
      columns: ["household_id","snapshot_id"]
isOneToOne: false
      referencedRelation: "snapshots"
      referencedColumns: ["household_id","id"]
    }
                  ]
                },"snapshots": {
                  Row: {
                    "created_at": string,"created_by": string | null,"deleted_at": string | null,"deleted_by": string | null,"household_id": string,"id": string,"on_date": string,"taken_at": string,"updated_at": string | null,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"deleted_by"?: string | null,"household_id"?: string,"id"?: string,"on_date": string,"taken_at"?: string,"updated_at"?: string | null,"updated_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"deleted_by"?: string | null,"household_id"?: string,"id"?: string,"on_date"?: string,"taken_at"?: string,"updated_at"?: string | null,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "snapshots_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "buy_shopping_item":
{ Args: { "added_at": string,"batch_id": string,"expires_on": string,"ingredient_id": string,"item_id": string,"qty": number }; Returns: Json
                           },
"create_household":
{ Args: { "display_name"?: string,"name": string }; Returns: string
                           },
"default_member_name":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"export_my_data":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"finish_shopping":
{ Args: { "batches": Json,"on_date": string }; Returns: string
                           },
"hook_before_user_created":
{ Args: { "event": Json }; Returns: Json
                           },
"join_household":
{ Args: { "code": string,"display_name"?: string }; Returns: string
                           },
"my_household":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"purge_user":
{ Args: { "uid": string }; Returns: undefined
                           },
"push_cron_tick":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"push_list_observe":
{ Args: { "by": string,"hid": string,"keys": (string)[] }; Returns: boolean
                           },
"push_list_refresh":
{ Args: { "hid": string,"keys": (string)[] }; Returns: undefined
                           },
"push_list_take":
{ Args: { "hid": string,"min_age"?: string }; Returns: {
              "authors": (string)[],"window_keys": (string)[]
            }[]
                           },
"require_live":
{ Args: { "rid": string,"tbl": string }; Returns: undefined
                           },
"restore":
{ Args: { "ids": (string)[],"tbl": string }; Returns: number
                           },
"rotate_invite_code":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"save_inventory_check":
{ Args: { "items": Json,"on_date": string }; Returns: string
                           },
"save_pantry_edits":
{ Args: { "adjustments": Json,"expiries"?: Json,"new_batches": Json }; Returns: undefined
                           },
"save_push_subscription":
{ Args: { "p_auth": string,"p_endpoint": string,"p_p256dh": string }; Returns: undefined
                           },
"save_recipe":
{ Args: { "instructions": string,"lines": Json,"name": string,"recipe_id": string,"serves": number,"tags": (string)[] }; Returns: string
                           },
"save_snapshot":
{ Args: { "batches": Json,"on_date": string }; Returns: string
                           },
"soft_delete":
{ Args: { "ids": (string)[],"tbl": string }; Returns: number
                           },
"unbuy":
{ Args: { "batch_id": string }; Returns: undefined
                           }
          }
          Enums: {
            "adjustment_kind": "used"|"set"|"finished"|"discard","unit": "g"|"ml"|"count"|"to_taste"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "adjustment_kind": ["used", "set", "finished", "discard"],"unit": ["g", "ml", "count", "to_taste"]
          }
        }
} as const
