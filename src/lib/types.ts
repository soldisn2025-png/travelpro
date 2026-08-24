export type TripStatus = "planning" | "confirmed" | "archived";
export type PlanningMode = "easygoing" | "normal" | "fast_walker";
export type TravelMode = "walk" | "transit" | "drive";
export type SpotVerificationStatus = "ai_candidate" | "verified" | "rejected";
export type DayItemType = "spot" | "fixed_anchor";
export type ScheduleMode = "auto" | "pinned" | "anchor" | "meal";
export type DayItemPriority = "must" | "nice" | "maybe";

export type Trip = {
  id: string;
  owner_user_id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: TripStatus;
  planning_mode: PlanningMode;
  travel_mode: TravelMode;
  share_token: string;
  created_at: string;
};

export type CityStop = {
  id: string;
  trip_id: string;
  city: string;
  country: string;
  order_index: number;
  nights: number;
  arrival_date: string | null;
  departure_date: string | null;
  arrival_details: string;
  departure_details: string;
  hotel_notes: string;
  flight_notes: string;
  hotel_name: string;
  hotel_address: string;
  hotel_place_id: string | null;
  hotel_latitude: number | null;
  hotel_longitude: number | null;
};

export type TravelLeg = {
  id: string;
  trip_id: string;
  to_city_stop_id: string | null;
  order_index: number;
  origin: string;
  destination: string;
  departure_date: string | null;
  arrival_date: string | null;
  notes: string;
};

export type Spot = {
  id: string;
  city_stop_id: string;
  name: string;
  category: string;
  duration_minutes: number;
  indoor_outdoor: string;
  google_place_id: string | null;
  address: string;
  latitude: number | null;
  longitude: number | null;
  opening_hours: Record<string, unknown>;
  source_metadata: Record<string, unknown>;
  hours_verified_at: string | null;
  verification_status: SpotVerificationStatus;
};

export type DayPlan = {
  id: string;
  city_stop_id: string;
  plan_date: string;
  start_time: string;
  end_time: string;
};

export type DayItem = {
  id: string;
  day_plan_id: string;
  item_type: DayItemType;
  spot_id: string | null;
  title: string;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number;
  sort_order: number;
  travel_time_from_previous_minutes: number | null;
  travel_time_is_estimated: boolean;
  conflict_reason: string | null;
  schedule_mode: ScheduleMode;
  priority: DayItemPriority;
};

export type TripBundle = Trip & {
  travel_legs: TravelLeg[];
  city_stops: Array<
    CityStop & {
      spots: Spot[];
      day_plans: Array<DayPlan & { day_items: DayItem[] }>;
    }
  >;
};

export type PlaceCandidate = {
  placeId: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  openingHours: Record<string, unknown>;
};
