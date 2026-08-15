# PARA validator scope

## Night float

Night float is modeled as regular shift work, not as in-house or home call. It
therefore counts toward shared duty-hour and continuous-duty checks, but it
does not count toward the Art. 23.05, 23.06, or 23.07 in-house/home-call caps.
The Pediatric LOU adds its own night-float checks where applicable.

If a program treats night float differently, update the `night_float` call
type semantics and the affected rules in both `postcall` and `call-sheduler`
together.

## Standard and shift-based duty

Each base-PARA self-check has a rotation-level duty model. Existing schedules
default to standard duty. Standard duty applies the 12-hour weekday clinical
duty limit and prohibits scheduled non-call work on Saturday and Sunday.
Shift-based duty applies the 60-hour scheduled-shift limit in a rolling
seven-day window, prohibits additional call, and limits scheduled work to two
weekends in any four-week period.

Regular-shift and night-float entry duration is treated as clinical scheduled
duty for these checks. Named Holidays are not present in the standalone input,
so the standard-duty weekend check currently covers Saturday and Sunday only.
The self-check treats every entered duty as required scheduled work; it does
not have a way to record the voluntary additional work contemplated by Art.
23.01(h).
The Pediatrics LOU is an Art. 23.08 alternative schedule and does not inherit
these base Art. 23.02/23.03 checks.

## Combined in-house and home call

Art. 23.07 requires the rotation's primary call model. Postcall infers it from
the entered schedule: the call type with more shifts is primary. Equal counts
have the same pass/fail boundary under either cap table, so Postcall uses the
primarily home-call table for that tie.
