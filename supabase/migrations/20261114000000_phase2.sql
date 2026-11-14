-- Phase 2：認証・市民投稿・異議申し立て（docs/SPEC.md §2.7、§4、§7）
--
-- 方針
--   * 施設本体は Supabase に持たない。facility_index は投稿先の存在確認用の索引だけ。
--   * 書き込みはすべて SECURITY DEFINER の関数経由。テーブルへの直接の INSERT/UPDATE/DELETE は許可しない。
--   * reports は物理削除しない（CLAUDE.md 絶対ルール 5）。DELETE と TRUNCATE をトリガーで止める。
--   * 投稿者の ID は公開ビューで匿名化する。

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- テーブル
-- ---------------------------------------------------------------------------

-- ビルドスクリプト（sync-supabase）が同期する施設索引
create table public.facility_index (
  facility_id   text primary key,
  muni_key      text not null,
  name          text not null,
  deprecated_at timestamptz
);

-- config/amenity-defs.json から同期
create table public.amenity_defs (
  key          text primary key,
  value_type   text not null check (value_type in ('boolean', 'integer', 'enum')),
  enum_options jsonb
);

-- 確定値（原本）
create table public.facility_amenities (
  facility_id    text not null references public.facility_index (facility_id),
  amenity_key    text not null references public.amenity_defs (key),
  value          jsonb not null,
  confidence     text not null check (confidence in ('official', 'verified', 'reported', 'disputed')),
  evidence_count int not null default 0,
  observed_at    date,
  last_report_id uuid,
  updated_at     timestamptz not null default now(),
  primary key (facility_id, amenity_key)
);

-- 市民投稿（不変ログ）
create table public.reports (
  id            uuid primary key default gen_random_uuid(),
  facility_id   text not null references public.facility_index (facility_id),
  amenity_key   text not null references public.amenity_defs (key),
  value         jsonb not null,
  basis         text not null check (basis in ('official_doc', 'on_site', 'photo', 'hearsay')),
  source_url    text,
  photo_urls    text[],
  observed_at   date not null,
  note          text,
  reporter_id   uuid not null references auth.users (id),
  -- 投稿時点の投稿者の立場。施設管理者の投稿は official として扱う（SPEC §4.1）
  reporter_role text not null default 'user' check (reporter_role in ('user', 'facility_admin')),
  status        text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'superseded')),
  reviewed_by   uuid references auth.users (id),
  reviewed_at   timestamptz,
  reject_reason text,
  created_at    timestamptz not null default now()
);
create index reports_facility_idx on public.reports (facility_id, amenity_key, status);
create index reports_reporter_idx on public.reports (reporter_id, created_at);
create index reports_pending_idx on public.reports (created_at) where status = 'pending';

-- 異議申し立て
create table public.disputes (
  id              uuid primary key default gen_random_uuid(),
  facility_id     text not null references public.facility_index (facility_id),
  amenity_key     text not null references public.amenity_defs (key),
  reason          text not null,
  counter_value   jsonb,
  evidence_url    text,
  raiser_id       uuid not null references auth.users (id),
  status          text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolution_note text,
  resolved_by     uuid references auth.users (id),
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index disputes_facility_idx on public.disputes (facility_id, amenity_key, status);
create index disputes_raiser_idx on public.disputes (raiser_id, created_at);

-- 施設管理者アカウントの申請（SPEC §4.5）
create table public.facility_admin_applications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id),
  muni_key      text not null,
  organization  text not null,
  contact_email text not null,
  note          text,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note   text,
  reviewed_by   uuid references auth.users (id),
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now()
);

-- 削除・訂正の要請（SPEC §0.3、§4.5）。運営だけが読める
create table public.removal_requests (
  id             uuid primary key default gen_random_uuid(),
  facility_id    text,
  requester_name text not null,
  contact        text not null,
  relation       text not null,
  body           text not null,
  status         text not null default 'open' check (status in ('open', 'closed')),
  handling_note  text,
  handled_by     uuid references auth.users (id),
  handled_at     timestamptz,
  created_at     timestamptz not null default now()
);

-- 公開しない設定値
create schema if not exists private;
create table private.settings (
  key   text primary key,
  value jsonb not null
);
insert into private.settings (key, value) values
  -- 確定値がない項目への、根拠が公的文書・写真の投稿を自動承認するか（SPEC §4.2、§10-4。開始時は無効）
  ('auto_accept_new_with_evidence', 'false'::jsonb),
  -- 投稿者 ID を匿名化するときの塩
  ('reporter_salt', to_jsonb(encode(extensions.gen_random_bytes(24), 'hex'))),
  -- 投稿写真の URL の接頭辞（設定されていれば、それ以外の URL の写真は受け付けない）
  ('photo_base_url', 'null'::jsonb);

-- ---------------------------------------------------------------------------
-- 補助関数（private スキーマ。API からは呼べない）
-- ---------------------------------------------------------------------------

create function private.app_role() returns text
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'user')
$$;

create function private.is_moderator() returns boolean
language sql stable set search_path = '' as $$
  select auth.uid() is not null and private.app_role() in ('moderator', 'admin')
$$;

-- 施設管理者として、この市区町村の施設に公式の値を出せるか
create function private.is_facility_admin_for(p_muni_key text) returns boolean
language sql stable set search_path = '' as $$
  select auth.uid() is not null
     and private.app_role() = 'facility_admin'
     and coalesce(auth.jwt() -> 'app_metadata' -> 'muni_keys', '[]'::jsonb) ? p_muni_key
$$;

create function private.today_jst() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Tokyo')::date
$$;

-- 公開ビューから呼ばれるので、塩を読めるよう SECURITY DEFINER にする
create function private.reporter_tag(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select substr(encode(extensions.digest(
    p_user::text || (select value #>> '{}' from private.settings where key = 'reporter_salt'), 'sha256'), 'hex'), 1, 10)
$$;

-- 値が設備項目の型に合っているか。合わなければ例外
create function private.validate_value(p_key text, p_value jsonb) returns void
language plpgsql stable set search_path = '' as $$
declare
  d public.amenity_defs;
begin
  select * into d from public.amenity_defs where key = p_key;
  if not found then
    raise exception '設備項目が存在しません: %', p_key using errcode = '22023';
  end if;
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    raise exception '値が空です' using errcode = '22023';
  end if;
  if d.value_type = 'boolean' then
    if jsonb_typeof(p_value) <> 'boolean' then
      raise exception '「あり／なし」で指定してください' using errcode = '22023';
    end if;
  elsif d.value_type = 'integer' then
    if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}') !~ '^[0-9]{1,7}$' then
      raise exception '0 以上の整数で指定してください' using errcode = '22023';
    end if;
  elsif d.value_type = 'enum' then
    if jsonb_typeof(p_value) <> 'string' or not coalesce(d.enum_options, '[]'::jsonb) ? (p_value #>> '{}') then
      raise exception '選択肢にない値です' using errcode = '22023';
    end if;
  end if;
end
$$;

-- 確定値の信頼度・根拠件数を、承認済みの投稿と未解決の異議から計算し直す（SPEC §4.1）
create function private.recompute_amenity(p_facility text, p_key text) returns void
language plpgsql set search_path = '' as $$
declare
  v           jsonb;
  v_count     int;
  v_observed  date;
  v_last      uuid;
  v_conf      text;
begin
  select value into v from public.facility_amenities where facility_id = p_facility and amenity_key = p_key;
  if not found then
    return;
  end if;
  select count(*), max(observed_at) into v_count, v_observed
    from public.reports
   where facility_id = p_facility and amenity_key = p_key and status = 'accepted' and value = v;
  select id into v_last
    from public.reports
   where facility_id = p_facility and amenity_key = p_key and status = 'accepted' and value = v
   order by created_at desc limit 1;

  if exists (select 1 from public.disputes
              where facility_id = p_facility and amenity_key = p_key and status = 'open') then
    v_conf := 'disputed';
  elsif exists (select 1 from public.reports
                 where facility_id = p_facility and amenity_key = p_key and status = 'accepted'
                   and value = v and reporter_role = 'facility_admin') then
    v_conf := 'official';
  elsif (select count(distinct reporter_id) from public.reports
          where facility_id = p_facility and amenity_key = p_key and status = 'accepted' and value = v
            and basis in ('on_site', 'photo')
            and observed_at >= private.today_jst() - 180) >= 2 then
    v_conf := 'verified';
  else
    v_conf := 'reported';
  end if;

  update public.facility_amenities
     set confidence = v_conf, evidence_count = v_count, observed_at = v_observed,
         last_report_id = v_last, updated_at = now()
   where facility_id = p_facility and amenity_key = p_key;
end
$$;

-- 投稿を承認して確定値に反映する。値が変わる場合、以前の値を支えていた投稿は superseded にする
create function private.apply_report(p_report uuid, p_reviewer uuid) returns void
language plpgsql set search_path = '' as $$
declare
  r public.reports;
begin
  select * into r from public.reports where id = p_report for update;
  update public.reports
     set status = 'superseded'
   where facility_id = r.facility_id and amenity_key = r.amenity_key
     and status = 'accepted' and value <> r.value;
  update public.reports
     set status = 'accepted', reviewed_by = p_reviewer,
         reviewed_at = case when p_reviewer is null then null else now() end
   where id = p_report;
  insert into public.facility_amenities (facility_id, amenity_key, value, confidence)
  values (r.facility_id, r.amenity_key, r.value, 'reported')
  on conflict (facility_id, amenity_key) do update set value = excluded.value, updated_at = now();
  perform private.recompute_amenity(r.facility_id, r.amenity_key);
end
$$;

-- ---------------------------------------------------------------------------
-- reports を消させない
-- ---------------------------------------------------------------------------

create function private.forbid_report_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'reports のレコードは削除できません（status の遷移のみ）' using errcode = '42501';
end
$$;
create trigger reports_no_delete before delete on public.reports
  for each row execute function private.forbid_report_delete();
create trigger reports_no_truncate before truncate on public.reports
  for each statement execute function private.forbid_report_delete();

-- ---------------------------------------------------------------------------
-- 公開 API（すべて SECURITY DEFINER。入力検証とレート制限は関数内で行う）
-- ---------------------------------------------------------------------------

-- 投稿する。自動処理の結果（accepted / pending）を返す（SPEC §4.2）
create function public.submit_report(
  p_facility_id text,
  p_amenity_key text,
  p_value       jsonb,
  p_basis       text,
  p_observed_at date,
  p_source_url  text default null,
  p_photo_urls  text[] default null,
  p_note        text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid        uuid := auth.uid();
  v_muni       text;
  v_created    timestamptz;
  v_role       text := 'user';
  v_id         uuid;
  v_fa         public.facility_amenities;
  v_photo_base text;
  v_url        text;
begin
  if v_uid is null then
    raise exception 'ログインが必要です' using errcode = '28000';
  end if;
  select muni_key into v_muni from public.facility_index
   where facility_id = p_facility_id and deprecated_at is null;
  if not found then
    raise exception '施設が見つかりません' using errcode = '22023';
  end if;
  perform private.validate_value(p_amenity_key, p_value);

  if p_basis is null or p_basis not in ('official_doc', 'on_site', 'photo', 'hearsay') then
    raise exception '根拠を選んでください' using errcode = '22023';
  end if;
  if p_observed_at is null then
    raise exception '観測日を入力してください' using errcode = '22023';
  end if;
  if p_observed_at > private.today_jst() then
    raise exception '観測日に未来の日付は指定できません' using errcode = '22023';
  end if;
  if p_observed_at < date '2000-01-01' then
    raise exception '観測日が古すぎます' using errcode = '22023';
  end if;
  if p_basis = 'official_doc' and (p_source_url is null or p_source_url !~ '^https?://[^\s]{4,}$') then
    raise exception '公的文書を根拠にする場合は、その URL が必要です' using errcode = '22023';
  end if;
  if p_source_url is not null and (length(p_source_url) > 2000 or p_source_url !~ '^https?://[^\s]{4,}$') then
    raise exception 'URL の形式が正しくありません' using errcode = '22023';
  end if;
  if p_basis = 'photo' and coalesce(array_length(p_photo_urls, 1), 0) < 1 then
    raise exception '写真を根拠にする場合は、写真が1枚以上必要です' using errcode = '22023';
  end if;
  if coalesce(array_length(p_photo_urls, 1), 0) > 4 then
    raise exception '写真は4枚までです' using errcode = '22023';
  end if;
  select value #>> '{}' into v_photo_base from private.settings where key = 'photo_base_url';
  if p_photo_urls is not null then
    foreach v_url in array p_photo_urls loop
      if v_photo_base is null or left(v_url, length(v_photo_base)) <> v_photo_base then
        raise exception '写真は、このサイトからアップロードしたものだけ指定できます' using errcode = '22023';
      end if;
    end loop;
  end if;
  if p_note is not null and length(p_note) > 1000 then
    raise exception '補足は 1000 文字までです' using errcode = '22023';
  end if;

  if private.is_facility_admin_for(v_muni) then
    v_role := 'facility_admin';
  end if;

  -- 荒らし対策（SPEC §4.5）。施設管理者とモデレーターには適用しない
  if v_role = 'user' and not private.is_moderator() then
    select created_at into v_created from auth.users where id = v_uid;
    if v_created > now() - interval '24 hours'
       and (select count(*) from public.reports where reporter_id = v_uid) >= 3 then
      raise exception '登録から24時間は、投稿は3件までです' using errcode = '54000';
    end if;
    if (select count(*) from public.reports
         where reporter_id = v_uid and created_at > now() - interval '24 hours') >= 100 then
      raise exception '24時間あたりの投稿数の上限に達しました' using errcode = '54000';
    end if;
  end if;

  insert into public.reports
    (facility_id, amenity_key, value, basis, source_url, photo_urls, observed_at, note, reporter_id, reporter_role)
  values
    (p_facility_id, p_amenity_key, p_value, p_basis, p_source_url, p_photo_urls, p_observed_at,
     nullif(btrim(p_note), ''), v_uid, v_role)
  returning id into v_id;

  -- 自動処理
  select * into v_fa from public.facility_amenities
   where facility_id = p_facility_id and amenity_key = p_amenity_key;
  if v_role = 'facility_admin' then
    -- 施設管理者の投稿は official として即時反映
    perform private.apply_report(v_id, null);
  elsif found then
    if v_fa.confidence <> 'disputed' and v_fa.value = p_value then
      -- 確定値と一致 → 承認し、根拠件数を加算
      perform private.apply_report(v_id, null);
    end if;
    -- 確定値と矛盾、または争点中 → pending のままモデレーション待ち
  elsif (select value = 'true'::jsonb from private.settings where key = 'auto_accept_new_with_evidence')
        and p_basis in ('official_doc', 'photo') then
    perform private.apply_report(v_id, null);
  end if;

  return jsonb_build_object('id', v_id, 'status', (select status from public.reports where id = v_id));
end
$$;

-- モデレーターが投稿を承認・却下する
create function public.review_report(p_report_id uuid, p_decision text, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.reports;
begin
  if not private.is_moderator() then
    raise exception '権限がありません' using errcode = '42501';
  end if;
  select * into r from public.reports where id = p_report_id for update;
  if not found then
    raise exception '投稿が見つかりません' using errcode = '22023';
  end if;
  if r.status <> 'pending' then
    raise exception 'この投稿はすでに処理されています' using errcode = '22023';
  end if;
  if p_decision = 'accept' then
    perform private.apply_report(p_report_id, auth.uid());
  elsif p_decision = 'reject' then
    if p_reason is null or length(btrim(p_reason)) < 2 then
      raise exception '却下の理由を入力してください' using errcode = '22023';
    end if;
    update public.reports
       set status = 'rejected', reject_reason = btrim(p_reason), reviewed_by = auth.uid(), reviewed_at = now()
     where id = p_report_id;
  else
    raise exception '判断は accept か reject で指定してください' using errcode = '22023';
  end if;
end
$$;

-- 「この情報は違う」。その項目は即座に disputed になる（SPEC §4.4）
create function public.raise_dispute(
  p_facility_id   text,
  p_amenity_key   text,
  p_reason        text,
  p_counter_value jsonb default null,
  p_evidence_url  text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'ログインが必要です' using errcode = '28000';
  end if;
  if not exists (select 1 from public.facility_amenities
                  where facility_id = p_facility_id and amenity_key = p_amenity_key) then
    raise exception 'この項目には、まだ確定した値がありません' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 5 or length(p_reason) > 1000 then
    raise exception '理由は 5〜1000 文字で入力してください' using errcode = '22023';
  end if;
  if p_counter_value is not null and jsonb_typeof(p_counter_value) <> 'null' then
    perform private.validate_value(p_amenity_key, p_counter_value);
  else
    p_counter_value := null;
  end if;
  if p_evidence_url is not null and (length(p_evidence_url) > 2000 or p_evidence_url !~ '^https?://[^\s]{4,}$') then
    raise exception 'URL の形式が正しくありません' using errcode = '22023';
  end if;
  -- 濫用防止：1ユーザーあたり24時間で3件まで
  if not private.is_moderator()
     and (select count(*) from public.disputes
           where raiser_id = v_uid and created_at > now() - interval '24 hours') >= 3 then
    raise exception '異議の申し立ては、24時間で3件までです' using errcode = '54000';
  end if;
  if exists (select 1 from public.disputes
              where facility_id = p_facility_id and amenity_key = p_amenity_key
                and raiser_id = v_uid and status = 'open') then
    raise exception 'この項目には、すでに異議を申し立てています' using errcode = '22023';
  end if;

  insert into public.disputes (facility_id, amenity_key, reason, counter_value, evidence_url, raiser_id)
  values (p_facility_id, p_amenity_key, btrim(p_reason), p_counter_value, p_evidence_url, v_uid)
  returning id into v_id;
  perform private.recompute_amenity(p_facility_id, p_amenity_key);
  return v_id;
end
$$;

-- モデレーターが異議を解決・棄却する。
-- p_withdraw_value = true なら確定値を取り下げ、その項目を「未確認」に戻す（支えていた投稿は superseded）
create function public.resolve_dispute(
  p_dispute_id     uuid,
  p_decision       text,
  p_note           text,
  p_withdraw_value boolean default false
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.disputes;
begin
  if not private.is_moderator() then
    raise exception '権限がありません' using errcode = '42501';
  end if;
  select * into d from public.disputes where id = p_dispute_id for update;
  if not found then
    raise exception '異議が見つかりません' using errcode = '22023';
  end if;
  if d.status <> 'open' then
    raise exception 'この異議はすでに処理されています' using errcode = '22023';
  end if;
  if p_decision not in ('resolved', 'dismissed') then
    raise exception '判断は resolved か dismissed で指定してください' using errcode = '22023';
  end if;
  if p_note is null or length(btrim(p_note)) < 2 then
    raise exception '判断の理由を入力してください' using errcode = '22023';
  end if;
  update public.disputes
     set status = p_decision, resolution_note = btrim(p_note), resolved_by = auth.uid(), resolved_at = now()
   where id = p_dispute_id;
  if p_decision = 'resolved' and p_withdraw_value then
    update public.reports set status = 'superseded'
     where facility_id = d.facility_id and amenity_key = d.amenity_key and status = 'accepted';
    delete from public.facility_amenities
     where facility_id = d.facility_id and amenity_key = d.amenity_key;
  else
    perform private.recompute_amenity(d.facility_id, d.amenity_key);
  end if;
end
$$;

-- 施設管理者アカウントの申請
create function public.apply_facility_admin(
  p_muni_key text, p_organization text, p_contact_email text, p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'ログインが必要です' using errcode = '28000';
  end if;
  if p_muni_key !~ '^[0-9]{5}$' or not exists (select 1 from public.facility_index where muni_key = p_muni_key) then
    raise exception '市区町村が見つかりません' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_organization, ''))) < 2 or length(p_organization) > 200 then
    raise exception '所属を入力してください' using errcode = '22023';
  end if;
  if coalesce(p_contact_email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(p_contact_email) > 320 then
    raise exception '連絡先のメールアドレスを入力してください' using errcode = '22023';
  end if;
  if exists (select 1 from public.facility_admin_applications where user_id = v_uid and status = 'pending') then
    raise exception '審査中の申請があります' using errcode = '22023';
  end if;
  insert into public.facility_admin_applications (user_id, muni_key, organization, contact_email, note)
  values (v_uid, p_muni_key, btrim(p_organization), btrim(p_contact_email), nullif(btrim(left(p_note, 1000)), ''))
  returning id into v_id;
  return v_id;
end
$$;

-- 申請の承認・却下。承認すると、その利用者に施設管理者の権限と担当の市区町村を付ける
create function public.review_facility_admin_application(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.facility_admin_applications;
  v_meta jsonb;
  v_keys jsonb;
begin
  if not private.is_moderator() then
    raise exception '権限がありません' using errcode = '42501';
  end if;
  select * into a from public.facility_admin_applications where id = p_id for update;
  if not found or a.status <> 'pending' then
    raise exception '審査待ちの申請が見つかりません' using errcode = '22023';
  end if;
  update public.facility_admin_applications
     set status = case when p_approve then 'approved' else 'rejected' end,
         review_note = nullif(btrim(p_note), ''), reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;
  if p_approve then
    select coalesce(raw_app_meta_data, '{}'::jsonb) into v_meta from auth.users where id = a.user_id;
    -- すでにモデレーター以上の利用者の役割は下げない
    if coalesce(v_meta ->> 'role', 'user') in ('moderator', 'admin') then
      raise exception 'この利用者はすでに運営の権限を持っています' using errcode = '22023';
    end if;
    v_keys := coalesce(v_meta -> 'muni_keys', '[]'::jsonb);
    if not v_keys ? a.muni_key then
      v_keys := v_keys || to_jsonb(a.muni_key);
    end if;
    update auth.users
       set raw_app_meta_data = v_meta || jsonb_build_object('role', 'facility_admin', 'muni_keys', v_keys)
     where id = a.user_id;
  end if;
end
$$;

-- 削除・訂正の要請。ログインなしで出せる
create function public.submit_removal_request(
  p_requester_name text, p_contact text, p_relation text, p_body text, p_facility_id text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if length(btrim(coalesce(p_requester_name, ''))) < 1 or length(p_requester_name) > 200
     or length(btrim(coalesce(p_contact, ''))) < 3 or length(p_contact) > 320
     or length(btrim(coalesce(p_relation, ''))) < 1 or length(p_relation) > 200 then
    raise exception 'お名前・連絡先・施設との関係を入力してください' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_body, ''))) < 10 or length(p_body) > 4000 then
    raise exception '内容は 10〜4000 文字で入力してください' using errcode = '22023';
  end if;
  -- 連投の抑止（全体で1時間に30件まで）
  if (select count(*) from public.removal_requests where created_at > now() - interval '1 hour') >= 30 then
    raise exception '現在、受け付けが混み合っています。時間をおいて再度お試しください' using errcode = '54000';
  end if;
  insert into public.removal_requests (facility_id, requester_name, contact, relation, body)
  values (nullif(btrim(p_facility_id), ''), btrim(p_requester_name), btrim(p_contact), btrim(p_relation), btrim(p_body))
  returning id into v_id;
  return v_id;
end
$$;

create function public.close_removal_request(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_moderator() then
    raise exception '権限がありません' using errcode = '42501';
  end if;
  if p_note is null or length(btrim(p_note)) < 2 then
    raise exception '対応の内容を入力してください' using errcode = '22023';
  end if;
  update public.removal_requests
     set status = 'closed', handling_note = btrim(p_note), handled_by = auth.uid(), handled_at = now()
   where id = p_id and status = 'open';
  if not found then
    raise exception '未対応の要請が見つかりません' using errcode = '22023';
  end if;
end
$$;

-- 投稿者ごとの却下率。50% を超えたら要注意（SPEC §4.5）。モデレーターだけが見られる
create function public.moderation_reporter_stats()
returns table (reporter_tag text, total bigint, rejected bigint, reject_rate numeric, flagged boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_moderator() then
    raise exception '権限がありません' using errcode = '42501';
  end if;
  return query
    select private.reporter_tag(r.reporter_id),
           count(*) filter (where r.status <> 'pending'),
           count(*) filter (where r.status = 'rejected'),
           round(count(*) filter (where r.status = 'rejected')::numeric
                 / nullif(count(*) filter (where r.status <> 'pending'), 0), 3),
           coalesce(count(*) filter (where r.status = 'rejected')::numeric
                 / nullif(count(*) filter (where r.status <> 'pending'), 0) > 0.5, false)
      from public.reports r
     group by r.reporter_id
    having count(*) filter (where r.status <> 'pending') > 0
     order by 4 desc nulls last;
end
$$;

-- ---------------------------------------------------------------------------
-- 公開ビュー（投稿者を匿名化。自由記述は承認済みのものだけ出す）
-- ---------------------------------------------------------------------------

create view public.reports_public with (security_invoker = false) as
  select r.id, r.facility_id, r.amenity_key, r.value, r.basis, r.observed_at,
         r.status, r.reject_reason, r.reviewed_at, r.created_at, r.reporter_role,
         private.reporter_tag(r.reporter_id) as reporter_tag,
         case when r.status in ('accepted', 'superseded') then r.source_url end as source_url,
         case when r.status in ('accepted', 'superseded') then r.photo_urls end as photo_urls,
         case when r.status in ('accepted', 'superseded') then r.note end as note
    from public.reports r;

-- 異議は「対立する値」だけを公開する。理由の自由記述と根拠 URL はモデレーターだけが読む
create view public.disputes_public with (security_invoker = false) as
  select d.id, d.facility_id, d.amenity_key, d.counter_value, d.status,
         d.resolution_note, d.resolved_at, d.created_at,
         private.reporter_tag(d.raiser_id) as raiser_tag
    from public.disputes d;

-- モデレーション画面用：投稿者の匿名タグ付きの全項目
create view public.reports_moderation with (security_invoker = false) as
  select r.id, r.facility_id, r.amenity_key, r.value, r.basis, r.source_url, r.photo_urls, r.observed_at,
         r.note, r.status, r.reject_reason, r.reviewed_at, r.created_at, r.reporter_role,
         private.reporter_tag(r.reporter_id) as reporter_tag,
         f.name as facility_name, f.muni_key,
         fa.value as current_value, fa.confidence as current_confidence
    from public.reports r
    join public.facility_index f using (facility_id)
    left join public.facility_amenities fa
      on fa.facility_id = r.facility_id and fa.amenity_key = r.amenity_key
   where private.is_moderator();

create view public.disputes_moderation with (security_invoker = false) as
  select d.id, d.facility_id, d.amenity_key, d.reason, d.counter_value, d.evidence_url, d.status,
         d.resolution_note, d.resolved_at, d.created_at,
         private.reporter_tag(d.raiser_id) as raiser_tag,
         f.name as facility_name, f.muni_key,
         fa.value as current_value
    from public.disputes d
    join public.facility_index f using (facility_id)
    left join public.facility_amenities fa
      on fa.facility_id = d.facility_id and fa.amenity_key = d.amenity_key
   where private.is_moderator();

-- ---------------------------------------------------------------------------
-- 権限（SPEC §7）
-- ---------------------------------------------------------------------------

alter table public.facility_index              enable row level security;
alter table public.amenity_defs                enable row level security;
alter table public.facility_amenities          enable row level security;
alter table public.reports                     enable row level security;
alter table public.disputes                    enable row level security;
alter table public.facility_admin_applications enable row level security;
alter table public.removal_requests            enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on schema private from anon, authenticated, public;
revoke all on all tables in schema private from anon, authenticated, public;
revoke all on all functions in schema private from anon, authenticated, public;

-- 読み取り：索引・設備項目・確定値は全員
grant select on public.facility_index, public.amenity_defs, public.facility_amenities to anon, authenticated;
create policy "全員が読める" on public.facility_index     for select using (true);
create policy "全員が読める" on public.amenity_defs       for select using (true);
create policy "全員が読める" on public.facility_amenities for select using (true);

-- 投稿・異議の本体は、本人とモデレーターだけ。全員向けは匿名化した公開ビュー
grant select on public.reports, public.disputes, public.facility_admin_applications to authenticated;
create policy "本人とモデレーターが読める" on public.reports
  for select to authenticated using (reporter_id = (select auth.uid()) or private.is_moderator());
create policy "本人とモデレーターが読める" on public.disputes
  for select to authenticated using (raiser_id = (select auth.uid()) or private.is_moderator());
create policy "本人とモデレーターが読める" on public.facility_admin_applications
  for select to authenticated using (user_id = (select auth.uid()) or private.is_moderator());
grant select on public.removal_requests to authenticated;
create policy "モデレーターが読める" on public.removal_requests
  for select to authenticated using (private.is_moderator());

grant select on public.reports_public, public.disputes_public to anon, authenticated;
grant select on public.reports_moderation, public.disputes_moderation to authenticated;

-- RLS のポリシーと公開ビューから private の関数を呼べるようにする（中身は役割の判定と匿名化だけ）
grant usage on schema private to anon, authenticated;
grant execute on function private.app_role(), private.is_moderator(), private.reporter_tag(uuid) to anon, authenticated;

-- 書き込み：関数経由のみ
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.submit_report(text, text, jsonb, text, date, text, text[], text),
  public.review_report(uuid, text, text),
  public.raise_dispute(text, text, text, jsonb, text),
  public.resolve_dispute(uuid, text, text, boolean),
  public.apply_facility_admin(text, text, text, text),
  public.review_facility_admin_application(uuid, boolean, text),
  public.close_removal_request(uuid, text),
  public.moderation_reporter_stats()
  to authenticated;
grant execute on function public.submit_removal_request(text, text, text, text, text) to anon, authenticated;
