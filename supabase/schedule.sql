-- 오래된 그룹 자동 정리 (하루 한 번). schema.sql 을 실행한 뒤 SQL Editor 에서 한 번만 실행한다.
-- 그룹은 만든 날부터 180일이 지나면 멤버·수업까지 함께 지워진다 (delete_old_groups, 학기 단위 서비스).

create extension if not exists pg_cron;

-- 매일 03:00 (한국 시간). pg_cron 시각은 UTC 기준이라 18:00 으로 적는다.
-- 같은 이름으로 다시 실행하면 기존 작업이 새 내용으로 바뀐다.
select cron.schedule('delete-old-groups', '0 18 * * *', $$select delete_old_groups(180)$$);

-- 작업 실행 기록이 계속 쌓이지 않게 7일 지난 것은 지운다. 매일 03:10 (한국 시간).
select cron.schedule('cleanup-cron-history', '10 18 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);

-- 확인:
--   select jobname, schedule, active from cron.job;                       -- 등록된 작업
--   select jobname, status, return_message, start_time
--     from cron.job_run_details order by start_time desc limit 5;         -- 실행 결과 (다음날 03시 이후)
--   select delete_old_groups(180);                                        -- 지금 한 번 직접 실행 (지운 그룹 수)
-- 끄려면: select cron.unschedule('delete-old-groups');
