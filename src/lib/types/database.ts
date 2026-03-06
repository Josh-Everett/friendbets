export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          username: string
          display_name: string | null
          avatar_url: string | null
          created_at: string
        }
        Insert: {
          id: string
          username: string
          display_name?: string | null
          avatar_url?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          username?: string
          display_name?: string | null
          avatar_url?: string | null
          created_at?: string
        }
      }
      groups: {
        Row: {
          id: string
          name: string
          description: string | null
          currency_name: string
          currency_symbol: string
          starting_balance: number
          created_by: string
          created_at: string
          reset_frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly'
          season_end_at: string | null
          current_season_number: number
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          currency_name?: string
          currency_symbol?: string
          starting_balance?: number
          created_by: string
          created_at?: string
          reset_frequency?: 'weekly' | 'biweekly' | 'monthly' | 'quarterly'
          season_end_at?: string | null
          current_season_number?: number
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          currency_name?: string
          currency_symbol?: string
          starting_balance?: number
          created_by?: string
          created_at?: string
          reset_frequency?: 'weekly' | 'biweekly' | 'monthly' | 'quarterly'
          season_end_at?: string | null
          current_season_number?: number
        }
      }
      group_members: {
        Row: {
          id: string
          group_id: string
          user_id: string
          balance: number
          role: 'admin' | 'member'
          joined_at: string
          last_allowance_at: string
        }
        Insert: {
          id?: string
          group_id: string
          user_id: string
          balance?: number
          role?: 'admin' | 'member'
          joined_at?: string
          last_allowance_at?: string
        }
        Update: {
          id?: string
          group_id?: string
          user_id?: string
          balance?: number
          role?: 'admin' | 'member'
          joined_at?: string
          last_allowance_at?: string
        }
      }
      invite_codes: {
        Row: {
          id: string
          group_id: string
          code: string
          max_uses: number | null
          use_count: number
          expires_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          group_id: string
          code: string
          max_uses?: number | null
          use_count?: number
          expires_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          group_id?: string
          code?: string
          max_uses?: number | null
          use_count?: number
          expires_at?: string | null
          created_at?: string
        }
      }
      bets: {
        Row: {
          id: string
          group_id: string
          created_by: string
          title: string
          description: string | null
          subject_user_id: string | null
          status: 'open' | 'locked' | 'resolved' | 'cancelled'
          resolution_method: 'creator' | 'vote'
          outcome: boolean | null
          deadline: string | null
          created_at: string
          resolved_at: string | null
          virtual_liquidity: number
          yes_pool: number
          no_pool: number
          k: number
          creator_side: 'for' | 'against' | null
          creator_wager_amount: number | null
        }
        Insert: {
          id?: string
          group_id: string
          created_by: string
          title: string
          description?: string | null
          subject_user_id?: string | null
          status?: 'open' | 'locked' | 'resolved' | 'cancelled'
          resolution_method?: 'creator' | 'vote'
          outcome?: boolean | null
          deadline?: string | null
          created_at?: string
          resolved_at?: string | null
          virtual_liquidity?: number
          yes_pool?: number
          no_pool?: number
          k?: number
          creator_side?: 'for' | 'against' | null
          creator_wager_amount?: number | null
        }
        Update: {
          id?: string
          group_id?: string
          created_by?: string
          title?: string
          description?: string | null
          subject_user_id?: string | null
          status?: 'open' | 'locked' | 'resolved' | 'cancelled'
          resolution_method?: 'creator' | 'vote'
          outcome?: boolean | null
          deadline?: string | null
          created_at?: string
          resolved_at?: string | null
          virtual_liquidity?: number
          yes_pool?: number
          no_pool?: number
          k?: number
          creator_side?: 'for' | 'against' | null
          creator_wager_amount?: number | null
        }
      }
      bet_wagers: {
        Row: {
          id: string
          bet_id: string
          user_id: string
          side: 'for' | 'against'
          amount: number
          payout: number | null
          created_at: string
          shares: number
          price_avg: number
        }
        Insert: {
          id?: string
          bet_id: string
          user_id: string
          side: 'for' | 'against'
          amount: number
          payout?: number | null
          created_at?: string
          shares?: number
          price_avg?: number
        }
        Update: {
          id?: string
          bet_id?: string
          user_id?: string
          side?: 'for' | 'against'
          amount?: number
          payout?: number | null
          created_at?: string
          shares?: number
          price_avg?: number
        }
      }
      bet_votes: {
        Row: {
          id: string
          bet_id: string
          user_id: string
          vote: boolean
          created_at: string
        }
        Insert: {
          id?: string
          bet_id: string
          user_id: string
          vote: boolean
          created_at?: string
        }
        Update: {
          id?: string
          bet_id?: string
          user_id?: string
          vote?: boolean
          created_at?: string
        }
      }
      bet_proofs: {
        Row: {
          id: string
          bet_id: string
          uploaded_by: string
          file_path: string
          file_type: 'image' | 'video'
          caption: string | null
          created_at: string
        }
        Insert: {
          id?: string
          bet_id: string
          uploaded_by: string
          file_path: string
          file_type: 'image' | 'video'
          caption?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          bet_id?: string
          uploaded_by?: string
          file_path?: string
          file_type?: 'image' | 'video'
          caption?: string | null
          created_at?: string
        }
      }
      achievements: {
        Row: {
          id: string
          group_id: string
          user_id: string
          type: string
          title: string
          description: string | null
          bet_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          group_id: string
          user_id: string
          type: string
          title: string
          description?: string | null
          bet_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          group_id?: string
          user_id?: string
          type?: string
          title?: string
          description?: string | null
          bet_id?: string | null
          created_at?: string
        }
      }
      transactions: {
        Row: {
          id: string
          group_id: string
          user_id: string
          type: string
          amount: number
          balance_after: number
          reference_type: string | null
          reference_id: string | null
          description: string | null
          created_at: string
        }
        Insert: {
          id?: string
          group_id: string
          user_id: string
          type: string
          amount: number
          balance_after: number
          reference_type?: string | null
          reference_id?: string | null
          description?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          group_id?: string
          user_id?: string
          type?: string
          amount?: number
          balance_after?: number
          reference_type?: string | null
          reference_id?: string | null
          description?: string | null
          created_at?: string
        }
      }
      seasons: {
        Row: {
          id: string
          group_id: string
          season_number: number
          started_at: string
          ended_at: string | null
          rankings: any
          total_volume: number
          total_bets: number
          mvp_user_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          group_id: string
          season_number: number
          started_at: string
          ended_at?: string | null
          rankings?: any
          total_volume?: number
          total_bets?: number
          mvp_user_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          group_id?: string
          season_number?: number
          started_at?: string
          ended_at?: string | null
          rankings?: any
          total_volume?: number
          total_bets?: number
          mvp_user_id?: string | null
          created_at?: string
        }
      }
    }
    Functions: {
      buy_shares: {
        Args: { p_bet_id: string; p_user_id: string; p_side: string; p_amount: number }
        Returns: { wager_id: string; shares_received: number; avg_price: number }[]
      }
      resolve_market: {
        Args: { p_bet_id: string; p_outcome: boolean; p_resolved_by: string }
        Returns: void
      }
      cancel_bet: {
        Args: { p_bet_id: string; p_cancelled_by: string }
        Returns: void
      }
      create_market: {
        Args: {
          p_group_id: string; p_created_by: string; p_title: string;
          p_description: string | null; p_subject_user_id: string | null;
          p_resolution_method: string; p_deadline: string | null;
          p_virtual_liquidity: number; p_creator_side: string; p_creator_amount: number
        }
        Returns: string
      }
      credit_daily_allowance: {
        Args: { p_group_id: string; p_user_id: string }
        Returns: number
      }
      reset_season: {
        Args: { p_group_id: string }
        Returns: boolean
      }
      join_group: {
        Args: { p_code: string }
        Returns: string
      }
      create_group: {
        Args: {
          p_name: string; p_description: string | null;
          p_currency_name: string | null; p_currency_symbol: string | null;
          p_starting_balance: number
        }
        Returns: string
      }
    }
    Views: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
