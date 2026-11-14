-- Phase 2 の関数と権限の検証。すべてトランザクション内で実行し、最後に ROLLBACK する（何も残さない）。
-- 実行：( supabase db query --linked -f supabase/tests/phase2_functions.sql )
begin;

create temp table t_result (n serial, name text, ok boolean, detail text) on commit drop;
grant all on t_result to public;
grant usage, select on sequence t_result_n_seq to public;

-- テスト用の利用者（ロールバックで消える）
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at, raw_app_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.invalid', now() - interval '3 days', now(), '{}'),
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@test.invalid', now() - interval '3 days', now(), '{}'),
  ('00000000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@test.invalid', now(), now(), '{}'),
  ('00000000-0000-4000-8000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm@test.invalid', now() - interval '3 days', now(), '{"role":"moderator"}'),
  ('00000000-0000-4000-8000-00000000000e', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f@test.invalid', now() - interval '3 days', now(), '{"role":"facility_admin","muni_keys":["01100"]}');

create function pg_temp.as_user(p_letter text, p_meta jsonb default '{}') returns void language sql as $$
  select set_config('request.jwt.claims', case when p_letter is null then '' else
    jsonb_build_object('sub', '00000000-0000-4000-8000-00000000000' || p_letter, 'role', 'authenticated', 'app_metadata', p_meta)::text end, true)
$$;
-- 例外になることを確かめる
create function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlerrm like p_like;
end $$;

do $$
declare
  f1 text := (select facility_id from public.facility_index where muni_key = '01100' order by facility_id limit 1);
  f2 text := (select facility_id from public.facility_index where muni_key = '13101' order by facility_id limit 1);
  today date := (now() at time zone 'Asia/Tokyo')::date;
  r jsonb; rid uuid; did uuid; fa public.facility_amenities; n int;
  mod jsonb := '{"role":"moderator"}';
  fadm jsonb := '{"role":"facility_admin","muni_keys":["01100"]}';
begin
  -- 未ログインは投稿できない
  perform pg_temp.as_user(null);
  insert into t_result (name, ok) values ('未ログインは投稿できない',
    pg_temp.fails(format($q$select public.submit_report(%L,'wifi','true','on_site',%L)$q$, f1, today), '%ログイン%'));

  -- 入力検証
  perform pg_temp.as_user('a');
  insert into t_result (name, ok) values
    ('型の合わない値は拒否', pg_temp.fails(format($q$select public.submit_report(%L,'wifi','"yes"','on_site',%L)$q$, f1, today), '%あり／なし%')),
    ('選択肢にない値は拒否', pg_temp.fails(format($q$select public.submit_report(%L,'aircon_main_hall','"cold"','on_site',%L)$q$, f1, today), '%選択肢%')),
    ('負の数は拒否', pg_temp.fails(format($q$select public.submit_report(%L,'toilet_total','-1','on_site',%L)$q$, f1, today), '%整数%')),
    ('未来の観測日は拒否', pg_temp.fails(format($q$select public.submit_report(%L,'wifi','true','on_site',%L)$q$, f1, today + 2), '%未来%')),
    ('公的文書は URL 必須', pg_temp.fails(format($q$select public.submit_report(%L,'wifi','true','official_doc',%L)$q$, f1, today), '%URL%')),
    ('写真は1枚以上必須', pg_temp.fails(format($q$select public.submit_report(%L,'wifi','true','photo',%L)$q$, f1, today), '%写真%')),
    ('外部の写真 URL は拒否', pg_temp.fails(format($q$select public.submit_report(%L,'wifi','true','photo',%L,null,array['https://example.com/x.jpg'])$q$, f1, today), '%このサイトから%')),
    ('存在しない施設は拒否', pg_temp.fails(format($q$select public.submit_report('NOPE','wifi','true','on_site',%L)$q$, today), '%施設が見つかりません%'));

  -- 確定値がない項目への投稿は pending（公的文書が根拠でも自動承認しない：開始時の設定）
  r := public.submit_report(f1, 'aircon_main_hall', '"none"', 'official_doc', today, 'https://example.lg.jp/doc.pdf');
  rid := (r ->> 'id')::uuid;
  insert into t_result (name, ok, detail) values ('確定値なしの投稿は pending', r ->> 'status' = 'pending', r::text);
  insert into t_result (name, ok) values ('pending では確定値ができない',
    not exists (select 1 from public.facility_amenities where facility_id = f1));

  -- 一般の利用者は承認できない
  insert into t_result (name, ok) values ('一般の利用者は承認できない',
    pg_temp.fails(format($q$select public.review_report(%L,'accept')$q$, rid), '%権限%'));

  -- モデレーターが承認 → reported
  perform pg_temp.as_user('d', mod);
  perform public.review_report(rid, 'accept');
  select * into fa from public.facility_amenities where facility_id = f1 and amenity_key = 'aircon_main_hall';
  insert into t_result (name, ok, detail) values ('承認すると確定値になる（reported・根拠1件）',
    fa.value = '"none"' and fa.confidence = 'reported' and fa.evidence_count = 1, row_to_json(fa)::text);
  insert into t_result (name, ok) values ('処理済みの投稿は再処理できない',
    pg_temp.fails(format($q$select public.review_report(%L,'reject','x y')$q$, rid), '%すでに処理%'));

  -- 確定値と一致する投稿は自動承認。現地確認が2名そろうと verified
  perform pg_temp.as_user('a');
  r := public.submit_report(f1, 'aircon_main_hall', '"none"', 'on_site', today - 10);
  insert into t_result (name, ok, detail) values ('確定値と一致する投稿は自動承認', r ->> 'status' = 'accepted', r::text);
  select * into fa from public.facility_amenities where facility_id = f1 and amenity_key = 'aircon_main_hall';
  insert into t_result (name, ok, detail) values ('現地確認が1名ではまだ reported', fa.confidence = 'reported' and fa.evidence_count = 2, fa.confidence);
  perform pg_temp.as_user('b');
  r := public.submit_report(f1, 'aircon_main_hall', '"none"', 'on_site', today - 5);
  select * into fa from public.facility_amenities where facility_id = f1 and amenity_key = 'aircon_main_hall';
  insert into t_result (name, ok, detail) values ('異なる2名の現地確認で verified', fa.confidence = 'verified' and fa.evidence_count = 3, fa.confidence || ' ' || fa.evidence_count);

  -- 確定値と矛盾する投稿は pending のまま。却下には理由が必要
  r := public.submit_report(f1, 'aircon_main_hall', '"full"', 'hearsay', today);
  rid := (r ->> 'id')::uuid;
  insert into t_result (name, ok) values ('確定値と矛盾する投稿は pending', r ->> 'status' = 'pending');
  perform pg_temp.as_user('d', mod);
  insert into t_result (name, ok) values ('理由なしの却下は拒否',
    pg_temp.fails(format($q$select public.review_report(%L,'reject','')$q$, rid), '%理由%'));
  perform public.review_report(rid, 'reject', '伝聞のみで、確定値を覆す根拠がない');
  insert into t_result (name, ok) values ('却下しても確定値は変わらない',
    (select value = '"none"' and confidence = 'verified' from public.facility_amenities where facility_id = f1 and amenity_key = 'aircon_main_hall'));

  -- 異議：即座に disputed。争点中は一致する投稿も自動承認しない
  perform pg_temp.as_user('b');
  did := public.raise_dispute(f1, 'aircon_main_hall', '今年の夏に設置工事があった', '"full"');
  insert into t_result (name, ok) values ('異議を出すと即座に disputed',
    (select confidence = 'disputed' from public.facility_amenities where facility_id = f1 and amenity_key = 'aircon_main_hall'));
  insert into t_result (name, ok) values ('同じ項目に二重の異議は出せない',
    pg_temp.fails(format($q$select public.raise_dispute(%L,'aircon_main_hall','もう一度申し立てます')$q$, f1), '%すでに異議%'));
  insert into t_result (name, ok) values ('確定値のない項目には異議を出せない',
    pg_temp.fails(format($q$select public.raise_dispute(%L,'wifi','値がないはずです')$q$, f1), '%確定した値がありません%'));
  perform pg_temp.as_user('a');
  r := public.submit_report(f1, 'aircon_main_hall', '"none"', 'on_site', today);
  insert into t_result (name, ok) values ('争点中は一致する投稿も pending', r ->> 'status' = 'pending');

  -- 異議の棄却 → 信頼度が元に戻る
  perform pg_temp.as_user('d', mod);
  perform public.resolve_dispute(did, 'dismissed', '設置工事の事実を確認できなかった');
  insert into t_result (name, ok) values ('異議を棄却すると verified に戻る',
    (select confidence = 'verified' from public.facility_amenities where facility_id = f1 and amenity_key = 'aircon_main_hall'));

  -- 異議の解決で値を取り下げる → 未確認に戻り、支えていた投稿は superseded
  perform pg_temp.as_user('b');
  did := public.raise_dispute(f1, 'aircon_main_hall', '設置済みの写真がある', '"full"');
  perform pg_temp.as_user('d', mod);
  perform public.resolve_dispute(did, 'resolved', '確定値を取り下げ、再確認を待つ', true);
  insert into t_result (name, ok) values ('値を取り下げると未確認に戻る',
    not exists (select 1 from public.facility_amenities where facility_id = f1 and amenity_key = 'aircon_main_hall'));
  insert into t_result (name, ok) values ('取り下げた値の投稿は superseded（消えない）',
    (select count(*) from public.reports where facility_id = f1 and amenity_key = 'aircon_main_hall' and status = 'superseded') = 3);

  -- 異議は24時間で3件まで
  perform pg_temp.as_user('d', mod);
  for n in 1..4 loop
    r := public.submit_report(f2, (array['wifi','elevator','kitchen','insulation'])[n], 'true', 'on_site', today);
    perform public.review_report((r ->> 'id')::uuid, 'accept');
  end loop;
  perform pg_temp.as_user('a');
  perform public.raise_dispute(f2, 'wifi', '現地で確認できなかった');
  perform public.raise_dispute(f2, 'elevator', '現地で確認できなかった');
  perform public.raise_dispute(f2, 'kitchen', '現地で確認できなかった');
  insert into t_result (name, ok) values ('異議は24時間で3件まで',
    pg_temp.fails(format($q$select public.raise_dispute(%L,'insulation','現地で確認できなかった')$q$, f2), '%3件まで%'));

  -- 新規アカウントは登録後24時間、投稿3件まで
  perform pg_temp.as_user('c');
  perform public.submit_report(f2, 'shower', '"none"', 'on_site', today);
  perform public.submit_report(f2, 'toilet_total', '12', 'on_site', today);
  perform public.submit_report(f2, 'solar_battery', 'false', 'on_site', today);
  insert into t_result (name, ok) values ('新規アカウントは24時間で3件まで',
    pg_temp.fails(format($q$select public.submit_report(%L,'water_supply','true','on_site',%L)$q$, f2, today), '%3件まで%'));

  -- 施設管理者：担当の市区町村では official として即時反映。担当外では一般の利用者と同じ
  perform pg_temp.as_user('e', fadm);
  r := public.submit_report(f1, 'power_backup', '"full"', 'official_doc', today, 'https://example.lg.jp/a');
  insert into t_result (name, ok, detail) values ('施設管理者の投稿は official で即時反映',
    r ->> 'status' = 'accepted' and (select confidence = 'official' from public.facility_amenities where facility_id = f1 and amenity_key = 'power_backup'), r::text);
  r := public.submit_report(f2, 'power_backup', '"full"', 'official_doc', today, 'https://example.lg.jp/a');
  insert into t_result (name, ok) values ('担当外の市区町村では pending', r ->> 'status' = 'pending');

  -- 却下率の集計
  perform pg_temp.as_user('d', mod);
  -- 却下率：ちょうど 50% は要注意にしない（「50% を超えたら」）
  insert into t_result (name, ok, detail) values ('却下率がちょうど 50% なら要注意にしない',
    (select count(*) from public.moderation_reporter_stats() where reject_rate = 0.5 and not flagged) = 1
    and (select count(*) from public.moderation_reporter_stats() where flagged) = 0,
    (select string_agg(total || '/' || rejected || '/' || flagged, ' ') from public.moderation_reporter_stats()));
  -- もう1件却下されると 2/3 になり、要注意になる
  perform pg_temp.as_user('b');
  r := public.submit_report(f2, 'wifi', 'false', 'hearsay', today);
  perform pg_temp.as_user('d', mod);
  perform public.review_report((r ->> 'id')::uuid, 'reject', '根拠が伝聞のみ');
  insert into t_result (name, ok) values ('却下率が 50% を超えると要注意の印',
    (select count(*) from public.moderation_reporter_stats() where flagged) = 1);

  -- 削除要請（ログインなし）
  perform pg_temp.as_user(null);
  insert into t_result (name, ok) values ('削除要請はログインなしで出せる',
    public.submit_removal_request('山田', 'yamada@example.lg.jp', '施設の管理者', 'この施設の設備情報に誤りがあるため訂正を求めます。', f1) is not null);
  insert into t_result (name, ok) values ('短すぎる削除要請は拒否',
    pg_temp.fails($q$select public.submit_removal_request('a','b@c.d','x','短い')$q$, '%10〜4000%'));

  -- reports は削除できない（テーブルの所有者でも）
  insert into t_result (name, ok) values ('reports は DELETE できない',
    pg_temp.fails('delete from public.reports', '%削除できません%'));
  insert into t_result (name, ok) values ('reports は TRUNCATE できない',
    pg_temp.fails('truncate public.reports cascade', '%削除できません%'));
end $$;

-- 権限（RLS）。匿名の閲覧者として確かめる
set local role anon;
select set_config('request.jwt.claims', '', true);
insert into t_result (name, ok) values
  ('匿名：確定値は読める', (select count(*) from public.facility_amenities) > 0),
  ('匿名：公開ビューで投稿履歴を読める', (select count(*) from public.reports_public) > 0),
  ('匿名：公開ビューに投稿者 ID の列がない', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'reports_public' and column_name = 'reporter_id')),
  ('匿名：未承認の投稿の自由記述と URL は出ない', not exists (select 1 from public.reports_public where status in ('pending', 'rejected') and (note is not null or source_url is not null or photo_urls is not null))),
  ('匿名：異議の理由は公開ビューに出ない', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'disputes_public' and column_name in ('reason', 'evidence_url', 'raiser_id'))),
  ('匿名：モデレーション用ビューは読めない', pg_temp.fails('select count(*) from public.reports_moderation', '%permission denied%')),
  ('匿名：reports 本体は読めない', pg_temp.fails('select count(*) from public.reports', '%permission denied%')),
  ('匿名：removal_requests は読めない', pg_temp.fails('select count(*) from public.removal_requests', '%permission denied%')),
  ('匿名：確定値を直接書き換えられない', pg_temp.fails($q$update public.facility_amenities set value = 'true'$q$, '%permission denied%')),
  ('匿名：submit_report は呼べない', pg_temp.fails($q$select public.submit_report('x','wifi','true','on_site',current_date)$q$, '%permission denied%')),
  ('匿名：private の設定は読めない', pg_temp.fails('select * from private.settings', '%permission denied%'));

-- ログイン済みの一般利用者
set local role authenticated;
select pg_temp.as_user('a');
insert into t_result (name, ok) values
  ('利用者：自分の投稿だけ読める', (select count(*) > 0 and count(*) = count(*) filter (where reporter_id = '00000000-0000-4000-8000-00000000000a') from public.reports)),
  ('利用者：reports に直接 INSERT できない', pg_temp.fails($q$insert into public.reports (facility_id, amenity_key, value, basis, observed_at, reporter_id) select facility_id, 'wifi', 'true', 'on_site', current_date, '00000000-0000-4000-8000-00000000000a' from public.facility_index limit 1$q$, '%permission denied%')),
  ('利用者：投稿の status を直接変えられない', pg_temp.fails($q$update public.reports set status = 'accepted'$q$, '%permission denied%')),
  ('利用者：モデレーション用ビューは0件', (select count(*) from public.disputes_moderation) = 0),
  ('利用者：削除要請は読めない', (select count(*) from public.removal_requests) = 0);

-- モデレーター
select pg_temp.as_user('d', '{"role":"moderator"}');
insert into t_result (name, ok) values
  ('モデレーター：全員の投稿を読める', (select count(distinct reporter_id) from public.reports) >= 4),
  ('モデレーター：モデレーション用ビューを読める', (select count(*) from public.reports_moderation) > 0),
  ('モデレーター：削除要請を読める', (select count(*) from public.removal_requests) = 1);

reset role;
select name, ok, detail from t_result order by n;
rollback;
