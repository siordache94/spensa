
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
                    "at": string,"batch_id": string | null,"household_id": string,"id": string,"ingredient_id": string,"kind": Database["public"]['Enums']["adjustment_kind"],"qty": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "at"?: string,"batch_id"?: string | null,"household_id"?: string,"id"?: string,"ingredient_id": string,"kind": Database["public"]['Enums']["adjustment_kind"],"qty"?: number | null
                  }
                  Update: {
                    "at"?: string,"batch_id"?: string | null,"household_id"?: string,"id"?: string,"ingredient_id"?: string,"kind"?: Database["public"]['Enums']["adjustment_kind"],"qty"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "adjustments_batch_id_fkey"
      columns: ["batch_id"]
isOneToOne: false
      referencedRelation: "batches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "adjustments_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "adjustments_ingredient_id_fkey"
      columns: ["ingredient_id"]
isOneToOne: false
      referencedRelation: "ingredients"
      referencedColumns: ["id"]
    }
                  ]
                },"batches": {
                  Row: {
                    "added_at": string,"expires_on": string | null,"household_id": string,"id": string,"ingredient_id": string,"qty": number
                  }
                  ComputedFields: never
                  Insert: {
                    "added_at"?: string,"expires_on"?: string | null,"household_id"?: string,"id"?: string,"ingredient_id": string,"qty": number
                  }
                  Update: {
                    "added_at"?: string,"expires_on"?: string | null,"household_id"?: string,"id"?: string,"ingredient_id"?: string,"qty"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "batches_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "batches_ingredient_id_fkey"
      columns: ["ingredient_id"]
isOneToOne: false
      referencedRelation: "ingredients"
      referencedColumns: ["id"]
    }
                  ]
                },"household_members": {
                  Row: {
                    "household_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "household_id": string,"user_id": string
                  }
                  Update: {
                    "household_id"?: string,"user_id"?: string
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
                    "created_at": string,"expiring_days": number,"id": string,"invite_code": string,"name": string,"slots": (string)[],"timezone": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"expiring_days"?: number,"id"?: string,"invite_code"?: string,"name": string,"slots"?: (string)[],"timezone"?: string
                  }
                  Update: {
                    "created_at"?: string,"expiring_days"?: number,"id"?: string,"invite_code"?: string,"name"?: string,"slots"?: (string)[],"timezone"?: string
                  }
                  Relationships: [
                    
                  ]
                },"ingredients": {
                  Row: {
                    "archived": boolean,"category": string | null,"household_id": string,"id": string,"min_stock": number | null,"name": string,"on_hand": boolean,"pack_size": number | null,"shelf_life_days": number | null,"unit": Database["public"]['Enums']["unit"]
                  }
                  ComputedFields: never
                  Insert: {
                    "archived"?: boolean,"category"?: string | null,"household_id"?: string,"id"?: string,"min_stock"?: number | null,"name": string,"on_hand"?: boolean,"pack_size"?: number | null,"shelf_life_days"?: number | null,"unit": Database["public"]['Enums']["unit"]
                  }
                  Update: {
                    "archived"?: boolean,"category"?: string | null,"household_id"?: string,"id"?: string,"min_stock"?: number | null,"name"?: string,"on_hand"?: boolean,"pack_size"?: number | null,"shelf_life_days"?: number | null,"unit"?: Database["public"]['Enums']["unit"]
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
                    "date": string,"household_id": string,"id": string,"portions": number,"position": number,"recipe_id": string | null,"slot": string
                  }
                  ComputedFields: never
                  Insert: {
                    "date": string,"household_id"?: string,"id"?: string,"portions": number,"position"?: number,"recipe_id"?: string | null,"slot": string
                  }
                  Update: {
                    "date"?: string,"household_id"?: string,"id"?: string,"portions"?: number,"position"?: number,"recipe_id"?: string | null,"slot"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "planned_meals_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "planned_meals_recipe_id_fkey"
      columns: ["recipe_id"]
isOneToOne: false
      referencedRelation: "recipes"
      referencedColumns: ["id"]
    }
                  ]
                },"recipe_ingredients": {
                  Row: {
                    "household_id": string,"ingredient_id": string,"qty_per_portion": number | null,"recipe_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "household_id"?: string,"ingredient_id": string,"qty_per_portion"?: number | null,"recipe_id": string
                  }
                  Update: {
                    "household_id"?: string,"ingredient_id"?: string,"qty_per_portion"?: number | null,"recipe_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "recipe_ingredients_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "recipe_ingredients_ingredient_id_fkey"
      columns: ["ingredient_id"]
isOneToOne: false
      referencedRelation: "ingredients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "recipe_ingredients_recipe_id_fkey"
      columns: ["recipe_id"]
isOneToOne: false
      referencedRelation: "recipes"
      referencedColumns: ["id"]
    }
                  ]
                },"recipes": {
                  Row: {
                    "created_at": string,"household_id": string,"id": string,"instructions": string,"name": string,"serves": number,"tags": (string)[]
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"household_id"?: string,"id"?: string,"instructions"?: string,"name": string,"serves"?: number,"tags"?: (string)[]
                  }
                  Update: {
                    "created_at"?: string,"household_id"?: string,"id"?: string,"instructions"?: string,"name"?: string,"serves"?: number,"tags"?: (string)[]
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
                    "checked": boolean,"created_at": string,"household_id": string,"id": string,"ingredient_id": string | null,"qty": number | null,"text": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "checked"?: boolean,"created_at"?: string,"household_id"?: string,"id"?: string,"ingredient_id"?: string | null,"qty"?: number | null,"text"?: string | null
                  }
                  Update: {
                    "checked"?: boolean,"created_at"?: string,"household_id"?: string,"id"?: string,"ingredient_id"?: string | null,"qty"?: number | null,"text"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "shopping_items_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "shopping_items_ingredient_id_fkey"
      columns: ["ingredient_id"]
isOneToOne: false
      referencedRelation: "ingredients"
      referencedColumns: ["id"]
    }
                  ]
                },"snapshot_batches": {
                  Row: {
                    "batch_id": string,"household_id": string,"qty": number,"snapshot_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "batch_id": string,"household_id"?: string,"qty": number,"snapshot_id": string
                  }
                  Update: {
                    "batch_id"?: string,"household_id"?: string,"qty"?: number,"snapshot_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "snapshot_batches_batch_id_fkey"
      columns: ["batch_id"]
isOneToOne: false
      referencedRelation: "batches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "snapshot_batches_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "snapshot_batches_snapshot_id_fkey"
      columns: ["snapshot_id"]
isOneToOne: false
      referencedRelation: "snapshots"
      referencedColumns: ["id"]
    }
                  ]
                },"snapshots": {
                  Row: {
                    "household_id": string,"id": string,"on_date": string,"taken_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "household_id"?: string,"id"?: string,"on_date": string,"taken_at"?: string
                  }
                  Update: {
                    "household_id"?: string,"id"?: string,"on_date"?: string,"taken_at"?: string
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
{ Args: { "expires_on": string,"item_id": string,"qty": number }; Returns: string
                           },
"create_household":
{ Args: { "name": string }; Returns: string
                           },
"join_household":
{ Args: { "code": string }; Returns: string
                           },
"my_household":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"save_recipe":
{ Args: { "instructions": string,"lines": Json,"name": string,"recipe_id": string,"serves": number,"tags": (string)[] }; Returns: string
                           },
"save_snapshot":
{ Args: { "batches": Json,"on_date": string }; Returns: string
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
