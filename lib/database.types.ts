// Generated from the live Supabase schema. Do not edit by hand.
//
// Regenerate after any migration:
//   npx supabase gen types typescript --project-id wyuadcnrxisqmzygzhzd > lib/database.types.ts
//
// Note: job_* functions appear here because they exist in the public schema, but
// EXECUTE is granted to service_role only — calling them from the client will be
// refused by Postgres regardless of what the types allow.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action_type: Database["public"]["Enums"]["audit_action_type"]
          actor_user_id: string | null
          created_at: string
          group_id: string | null
          id: string
          metadata: Json
          target_user_id: string | null
        }
        Insert: {
          action_type: Database["public"]["Enums"]["audit_action_type"]
          actor_user_id?: string | null
          created_at?: string
          group_id?: string | null
          id?: string
          metadata?: Json
          target_user_id?: string | null
        }
        Update: {
          action_type?: Database["public"]["Enums"]["audit_action_type"]
          actor_user_id?: string | null
          created_at?: string
          group_id?: string | null
          id?: string
          metadata?: Json
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      content_reports: {
        Row: {
          content_reference: string
          content_type: Database["public"]["Enums"]["content_report_type"]
          created_at: string
          id: string
          reason: string | null
          reported_user_id: string | null
          reporter_user_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["content_report_status"]
        }
        Insert: {
          content_reference: string
          content_type: Database["public"]["Enums"]["content_report_type"]
          created_at?: string
          id?: string
          reason?: string | null
          reported_user_id?: string | null
          reporter_user_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["content_report_status"]
        }
        Update: {
          content_reference?: string
          content_type?: Database["public"]["Enums"]["content_report_type"]
          created_at?: string
          id?: string
          reason?: string | null
          reported_user_id?: string | null
          reporter_user_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["content_report_status"]
        }
        Relationships: [
          {
            foreignKeyName: "content_reports_reported_user_id_fkey"
            columns: ["reported_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_reports_reporter_user_id_fkey"
            columns: ["reporter_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_reports_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_completion: {
        Row: { all_completed: boolean; date: string; user_id: string }
        Insert: { all_completed: boolean; date: string; user_id: string }
        Update: { all_completed?: boolean; date?: string; user_id?: string }
        Relationships: [
          {
            foreignKeyName: "daily_completion_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      digest_snapshots: {
        Row: { created_at: string; date: string; group_id: string; summary: Json }
        Insert: { created_at?: string; date: string; group_id: string; summary: Json }
        Update: { created_at?: string; date?: string; group_id?: string; summary?: Json }
        Relationships: [
          {
            foreignKeyName: "digest_snapshots_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_categories: {
        Row: { color_hex: string; id: string; name: string; slug: string }
        Insert: { color_hex: string; id?: string; name: string; slug: string }
        Update: { color_hex?: string; id?: string; name?: string; slug?: string }
        Relationships: []
      }
      goal_group_visibility: {
        Row: { goal_id: string; group_id: string; hidden: boolean }
        Insert: { goal_id: string; group_id: string; hidden?: boolean }
        Update: { goal_id?: string; group_id?: string; hidden?: boolean }
        Relationships: [
          {
            foreignKeyName: "goal_group_visibility_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_group_visibility_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          achieved_at: string | null
          archived_at: string | null
          category_id: string
          created_at: string
          deadline: string | null
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          achieved_at?: string | null
          archived_at?: string | null
          category_id: string
          created_at?: string
          deadline?: string | null
          id?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          achieved_at?: string | null
          archived_at?: string | null
          category_id?: string
          created_at?: string
          deadline?: string | null
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goals_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "goal_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      group_cycle_stats: {
        Row: {
          current_streak: number
          cycle_id: string
          longest_streak_in_cycle: number
          updated_at: string
          user_id: string
        }
        Insert: {
          current_streak?: number
          cycle_id: string
          longest_streak_in_cycle?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          current_streak?: number
          cycle_id?: string
          longest_streak_in_cycle?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_cycle_stats_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "group_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_cycle_stats_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      group_cycles: {
        Row: {
          current_streak: number
          deadline: string | null
          ended_at: string | null
          group_id: string
          id: string
          last_rollover_date: string | null
          longest_streak: number
          started_at: string
        }
        Insert: {
          current_streak?: number
          deadline?: string | null
          ended_at?: string | null
          group_id: string
          id?: string
          last_rollover_date?: string | null
          longest_streak?: number
          started_at?: string
        }
        Update: {
          current_streak?: number
          deadline?: string | null
          ended_at?: string | null
          group_id?: string
          id?: string
          last_rollover_date?: string | null
          longest_streak?: number
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_cycles_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      group_daily_completion: {
        Row: { all_members_completed: boolean; cycle_id: string; date: string }
        Insert: { all_members_completed: boolean; cycle_id: string; date: string }
        Update: { all_members_completed?: boolean; cycle_id?: string; date?: string }
        Relationships: [
          {
            foreignKeyName: "group_daily_completion_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "group_cycles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_member_category_stats: {
        Row: {
          category_id: string
          current_streak: number
          group_id: string
          longest_streak: number
          total_completions: number
          total_possible: number
          updated_at: string
          user_id: string
        }
        Insert: {
          category_id: string
          current_streak?: number
          group_id: string
          longest_streak?: number
          total_completions?: number
          total_possible?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          category_id?: string
          current_streak?: number
          group_id?: string
          longest_streak?: number
          total_completions?: number
          total_possible?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_member_category_stats_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "goal_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_member_category_stats_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_member_category_stats_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          group_id: string
          joined_at: string
          role: Database["public"]["Enums"]["group_member_role"]
          streak_grace: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          group_id: string
          joined_at?: string
          role?: Database["public"]["Enums"]["group_member_role"]
          streak_grace?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          group_id?: string
          joined_at?: string
          role?: Database["public"]["Enums"]["group_member_role"]
          streak_grace?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string
          default_stats_view: Database["public"]["Enums"]["default_stats_view"]
          group_status: Database["public"]["Enums"]["group_status"]
          id: string
          leaderboard_persists_across_cycles: boolean
          name: string
          pending_streak_joiners: Json
          streak_decision_pending: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_stats_view?: Database["public"]["Enums"]["default_stats_view"]
          group_status?: Database["public"]["Enums"]["group_status"]
          id?: string
          leaderboard_persists_across_cycles?: boolean
          name: string
          pending_streak_joiners?: Json
          streak_decision_pending?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_stats_view?: Database["public"]["Enums"]["default_stats_view"]
          group_status?: Database["public"]["Enums"]["group_status"]
          id?: string
          leaderboard_persists_across_cycles?: boolean
          name?: string
          pending_streak_joiners?: Json
          streak_decision_pending?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      invite_links: {
        Row: {
          created_at: string
          created_by: string | null
          enabled: boolean
          expires_at: string | null
          group_id: string
          id: string
          token: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          expires_at?: string | null
          group_id: string
          id?: string
          token: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          expires_at?: string | null
          group_id?: string
          id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invite_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invite_links_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          payload: Json
          pushed_at: string | null
          read_at: string | null
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          payload?: Json
          pushed_at?: string | null
          read_at?: string | null
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          payload?: Json
          pushed_at?: string | null
          read_at?: string | null
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      progress_entries: {
        Row: {
          check_in_date: string
          created_at: string
          goal_id: string | null
          id: string
          note: string | null
          note_shared: boolean
          photo_url: string | null
          user_id: string | null
        }
        Insert: {
          check_in_date: string
          created_at?: string
          goal_id?: string | null
          id?: string
          note?: string | null
          note_shared?: boolean
          photo_url?: string | null
          user_id?: string | null
        }
        Update: {
          check_in_date?: string
          created_at?: string
          goal_id?: string | null
          id?: string
          note?: string | null
          note_shared?: boolean
          photo_url?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "progress_entries_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "progress_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          device_label: string | null
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          device_label?: string | null
          endpoint: string
          id?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          device_label?: string | null
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_blocks: {
        Row: { blocked_user_id: string; blocker_user_id: string; created_at: string }
        Insert: { blocked_user_id: string; blocker_user_id: string; created_at?: string }
        Update: { blocked_user_id?: string; blocker_user_id?: string; created_at?: string }
        Relationships: [
          {
            foreignKeyName: "user_blocks_blocked_user_id_fkey"
            columns: ["blocked_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_blocks_blocker_user_id_fkey"
            columns: ["blocker_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_lifetime_stats: {
        Row: {
          current_streak: number
          longest_streak_ever: number
          total_days_completed: number
          total_goals_achieved: number
          updated_at: string
          user_id: string
          visible_on_profile: boolean
        }
        Insert: {
          current_streak?: number
          longest_streak_ever?: number
          total_days_completed?: number
          total_goals_achieved?: number
          updated_at?: string
          user_id: string
          visible_on_profile?: boolean
        }
        Update: {
          current_streak?: number
          longest_streak_ever?: number
          total_days_completed?: number
          total_goals_achieved?: number
          updated_at?: string
          user_id?: string
          visible_on_profile?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "user_lifetime_stats_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      username_history: {
        Row: { changed_at: string; id: string; old_username: string; user_id: string }
        Insert: { changed_at?: string; id?: string; old_username: string; user_id: string }
        Update: { changed_at?: string; id?: string; old_username?: string; user_id?: string }
        Relationships: [
          {
            foreignKeyName: "username_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          checkin_day_started_at: string | null
          checkin_timezone: string
          created_at: string
          display_name: string | null
          id: string
          last_rollover_date: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          checkin_day_started_at?: string | null
          checkin_timezone?: string
          created_at?: string
          display_name?: string | null
          id: string
          last_rollover_date?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          checkin_day_started_at?: string | null
          checkin_timezone?: string
          created_at?: string
          display_name?: string | null
          id?: string
          last_rollover_date?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      archive_circle: { Args: { p_group_id: string }; Returns: undefined }
      build_daily_digests: { Args: { p_date?: string }; Returns: number }
      circle_roster: {
        Args: { p_group_id: string }
        Returns: {
          checked_count: number
          checkin_date: string
          display_name: string
          goals: Json
          is_self: boolean
          role: string
          streak_grace: boolean
          total_count: number
          user_id: string
          username: string
        }[]
      }
      circle_preview: {
        Args: { p_token: string }
        Returns: {
          circle_name: string
          is_full: boolean
          member_count: number
          status: string
        }[]
      }
      complete_onboarding: {
        Args: { p_timezone: string; p_username: string }
        Returns: undefined
      }
      current_checkin_date: { Args: never; Returns: string }
      create_circle: { Args: { p_deadline?: string; p_name: string }; Returns: string }
      create_invite_link: {
        Args: {
          p_expires_at?: string
          p_group_id: string
          p_use_default_expiry?: boolean
        }
        Returns: string
      }
      cycle_continue: {
        Args: { p_group_id: string; p_new_deadline?: string }
        Returns: undefined
      }
      cycle_reset: { Args: { p_group_id: string; p_new_deadline?: string }; Returns: string }
      export_user_data: { Args: never; Returns: Json }
      join_circle: { Args: { p_token: string }; Returns: string }
      resolve_streak_decision: {
        Args: { p_continue: boolean; p_group_id: string }
        Returns: undefined
      }
      set_circle_deadline: {
        Args: { p_deadline: string; p_group_id: string }
        Returns: undefined
      }
      sync_checkin_timezone: { Args: { p_timezone: string }; Returns: undefined }
      transfer_ownership: {
        Args: { p_group_id: string; p_new_owner: string }
        Returns: undefined
      }
    }
    Enums: {
      audit_action_type:
        | "member_kicked"
        | "ownership_transferred"
        | "admin_promoted"
        | "admin_demoted"
        | "invite_link_toggled"
        | "invite_link_regenerated"
        | "group_deadline_changed"
        | "group_cycle_reset"
        | "group_cycle_extended"
        | "group_streak_continued"
        | "group_streak_reset"
        | "member_joined"
        | "member_left"
      content_report_status: "pending" | "reviewed" | "actioned" | "dismissed"
      content_report_type: "checkin_photo" | "checkin_note" | "planet_avatar"
      default_stats_view: "cycle_stats" | "leaderboard"
      group_member_role: "owner" | "admin" | "member"
      group_status: "active" | "locked" | "archived"
      notification_type:
        | "digest"
        | "kicked"
        | "invite_accepted"
        | "group_locked_renewal"
        | "deadline_changed"
    }
    CompositeTypes: { [_ in never]: never }
  }
}

type DefaultSchema = Database["public"]

export type Tables<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Row"]

export type TablesInsert<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Insert"]

export type TablesUpdate<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Update"]

export type Enums<T extends keyof DefaultSchema["Enums"]> =
  DefaultSchema["Enums"][T]

// Convenience aliases for the types used most across the app.
export type User = Tables<"users">
export type Goal = Tables<"goals">
export type GoalCategory = Tables<"goal_categories">
export type Circle = Tables<"groups">
export type CircleMember = Tables<"group_members">
export type Cycle = Tables<"group_cycles">
export type CheckIn = Tables<"progress_entries">
export type DailyCompletion = Tables<"daily_completion">
export type LifetimeStats = Tables<"user_lifetime_stats">
export type Notification = Tables<"notifications">

export type CircleRole = Enums<"group_member_role">
export type CircleStatus = Enums<"group_status">
export type NotificationType = Enums<"notification_type">
