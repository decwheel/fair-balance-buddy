export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.4"
  }
  public: {
    Tables: {
      bills: {
        Row: {
          amount: number
          created_at: string
          due_date: string
          frequency: string
          id: string
          movable: boolean
          name: string
          recurrence_anchor: string | null
          recurrence_interval: number
          series_id: string | null
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          due_date: string
          frequency?: string
          id?: string
          movable?: boolean
          name: string
          recurrence_anchor?: string | null
          recurrence_interval?: number
          series_id?: string | null
          source?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          due_date?: string
          frequency?: string
          id?: string
          movable?: boolean
          name?: string
          recurrence_anchor?: string | null
          recurrence_interval?: number
          series_id?: string | null
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      electricity_bills: {
        Row: {
          amount: number | null
          bill_date: string | null
          household_id: string | null
          id: string
          tariff: Json | null
        }
        Insert: {
          amount?: number | null
          bill_date?: string | null
          household_id?: string | null
          id?: string
          tariff?: Json | null
        }
        Update: {
          amount?: number | null
          bill_date?: string | null
          household_id?: string | null
          id?: string
          tariff?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "electricity_bills_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      electricity_readings: {
        Row: {
          end_at: string | null
          household_id: string | null
          id: number
          kwh: number | null
          start_at: string | null
        }
        Insert: {
          end_at?: string | null
          household_id?: string | null
          id?: number
          kwh?: number | null
          start_at?: string | null
        }
        Update: {
          end_at?: string | null
          household_id?: string | null
          id?: number
          kwh?: number | null
          start_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "electricity_readings_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      forecast_items: {
        Row: {
          amount: number | null
          dt: string | null
          forecast_id: string | null
          id: string
          kind: string | null
          name: string | null
          person: string | null
        }
        Insert: {
          amount?: number | null
          dt?: string | null
          forecast_id?: string | null
          id?: string
          kind?: string | null
          name?: string | null
          person?: string | null
        }
        Update: {
          amount?: number | null
          dt?: string | null
          forecast_id?: string | null
          id?: string
          kind?: string | null
          name?: string | null
          person?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "forecast_items_forecast_id_fkey"
            columns: ["forecast_id"]
            isOneToOne: false
            referencedRelation: "forecasts"
            referencedColumns: ["id"]
          },
        ]
      }
      forecasts: {
        Row: {
          created_at: string | null
          household_id: string | null
          id: string
          months: number | null
          starts_on: string | null
        }
        Insert: {
          created_at?: string | null
          household_id?: string | null
          id?: string
          months?: number | null
          starts_on?: string | null
        }
        Update: {
          created_at?: string | null
          household_id?: string | null
          id?: string
          months?: number | null
          starts_on?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "forecasts_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      gc_links: {
        Row: {
          created_at: string | null
          household_id: string | null
          id: string
          journey_id: string | null
          partner: string | null
          reference: string | null
          requisition_id: string | null
        }
        Insert: {
          created_at?: string | null
          household_id?: string | null
          id?: string
          journey_id?: string | null
          partner?: string | null
          reference?: string | null
          requisition_id?: string | null
        }
        Update: {
          created_at?: string | null
          household_id?: string | null
          id?: string
          journey_id?: string | null
          partner?: string | null
          reference?: string | null
          requisition_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gc_links_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      household_members: {
        Row: {
          household_id: string
          role: string | null
          user_id: string
        }
        Insert: {
          household_id: string
          role?: string | null
          user_id: string
        }
        Update: {
          household_id?: string
          role?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_members_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          created_at: string | null
          id: string
          name: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string | null
        }
        Relationships: []
      }
      journeys: {
        Row: {
          access_count: number | null
          created_at: string | null
          created_by_ip: unknown | null
          id: string
          secret: string
          secret_expires_at: string | null
          state: Json | null
          upgraded: boolean | null
          upgraded_household: string | null
          upgraded_user: string | null
        }
        Insert: {
          access_count?: number | null
          created_at?: string | null
          created_by_ip?: unknown | null
          id?: string
          secret: string
          secret_expires_at?: string | null
          state?: Json | null
          upgraded?: boolean | null
          upgraded_household?: string | null
          upgraded_user?: string | null
        }
        Update: {
          access_count?: number | null
          created_at?: string | null
          created_by_ip?: unknown | null
          id?: string
          secret?: string
          secret_expires_at?: string | null
          state?: Json | null
          upgraded?: boolean | null
          upgraded_household?: string | null
          upgraded_user?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journeys_upgraded_household_fkey"
            columns: ["upgraded_household"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      persons: {
        Row: {
          display_name: string | null
          household_id: string | null
          id: string
          label: string | null
        }
        Insert: {
          display_name?: string | null
          household_id?: string | null
          id?: string
          label?: string | null
        }
        Update: {
          display_name?: string | null
          household_id?: string | null
          id?: string
          label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "persons_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_audit_log: {
        Row: {
          action: string
          created_at: string | null
          id: string
          ip_address: unknown | null
          new_data: Json | null
          old_data: Json | null
          plan_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          id?: string
          ip_address?: unknown | null
          new_data?: Json | null
          old_data?: Json | null
          plan_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          id?: string
          ip_address?: unknown | null
          new_data?: Json | null
          old_data?: Json | null
          plan_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_audit_log_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          client_id: string
          doc: Json
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          client_id: string
          doc: Json
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          doc?: Json
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      recurring_bills: {
        Row: {
          active: boolean | null
          amount: number | null
          category: string | null
          confidence: number | null
          day_rule: string | null
          frequency: string | null
          household_id: string | null
          id: string
          name: string | null
          owner: string | null
        }
        Insert: {
          active?: boolean | null
          amount?: number | null
          category?: string | null
          confidence?: number | null
          day_rule?: string | null
          frequency?: string | null
          household_id?: string | null
          id?: string
          name?: string | null
          owner?: string | null
        }
        Update: {
          active?: boolean | null
          amount?: number | null
          category?: string | null
          confidence?: number | null
          day_rule?: string | null
          frequency?: string | null
          household_id?: string | null
          id?: string
          name?: string | null
          owner?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recurring_bills_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      wages_detected: {
        Row: {
          amount_per_month: number | null
          confirmed: boolean | null
          created_at: string | null
          frequency: string | null
          id: string
          last_seen_date: string | null
          next_date: string | null
          person_id: string | null
        }
        Insert: {
          amount_per_month?: number | null
          confirmed?: boolean | null
          created_at?: string | null
          frequency?: string | null
          id?: string
          last_seen_date?: string | null
          next_date?: string | null
          person_id?: string | null
        }
        Update: {
          amount_per_month?: number | null
          confirmed?: boolean | null
          created_at?: string | null
          frequency?: string | null
          id?: string
          last_seen_date?: string | null
          next_date?: string | null
          person_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wages_detected_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_journey_secret_valid: {
        Args: { journey_id: string; secret: string }
        Returns: boolean
      }
      is_member: {
        Args: { hh: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
