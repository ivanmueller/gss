-- Phone numbers in one format: app.format_phone, used once by its migration to tidy the
-- phones saved before, is nobody else's to call. Runs in one transaction that is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

select ok(
  not has_function_privilege('app_api', 'app.format_phone(text)', 'execute')
    and not has_function_privilege('anon', 'app.format_phone(text)', 'execute')
    and not has_function_privilege('authenticated', 'app.format_phone(text)', 'execute')
    and not has_function_privilege('service_role', 'app.format_phone(text)', 'execute'),
  'nobody but the owner calls app.format_phone');
select is(app.format_phone('403-555-0100'), '(403) 555-0100', 'a number with dashes');
select is(app.format_phone('+1 403 555 0100 x7'), '(403) 555-0100 x7', 'with +1 and an extension');
select is(app.format_phone('+44 20 7946 0958'), '+44 20 7946 0958', 'another country kept as written');
select is(app.format_phone('555-0100'), '555-0100', 'a short number kept as written');
select is(app.format_phone(null), null, 'none stays none');

select is(app.format_phone('4035550100x' || repeat('1', 29)), '4035550100x' || repeat('1', 29),
  'a number that formatting would make too long is kept as written');

select * from finish();
rollback;
