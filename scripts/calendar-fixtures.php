<?php
// Offline golden fixtures for Wallos's monthly-cost calendar policy.
// Run: php scripts/calendar-fixtures.php > test/data/calendar.json
// Runtime server does not require PHP.
date_default_timezone_set('UTC');
$scenarios = [
    [4,1,'2028-02-29','2028-02'], [4,1,'2028-02-29','2028-03'],
    [4,1,'2028-02-29','2027-02'], [4,1,'2028-02-29','2027-03'],
    [4,1,'2026-11-01','2026-11'], [4,1,'2026-11-01','2026-10'],
    [3,1,'2026-01-31','2026-02'], [3,1,'2026-01-31','2026-03'],
    [3,1,'2026-03-31','2026-02'], [3,1,'2026-03-31','2026-03'],
    [3,1,'2028-02-29','2027-02'], [3,2,'2026-12-31','2026-10'],
    [1,1,'2028-03-01','2028-02'], [1,1,'2028-03-01','2027-02'],
    [1,3,'2026-01-01','2026-11'], [1,10000,'2199-12-31','1900-01'],
    [2,1,'2026-11-02','2026-11'], [2,2,'2026-11-02','2026-11'],
    [2,1,'1900-01-01','2199-12'], [3,1,'1900-01-01','2199-12'],
];
$out = [];
foreach ($scenarios as [$cycle,$frequency,$next,$month]) {
    $unit = [1=>'days',2=>'weeks',3=>'months',4=>'years'][$cycle];
    $anchor = strtotime($next); $start = strtotime($month.'-01');
    while ($anchor > $start) $anchor = strtotime('-+'.$frequency.' '.$unit, $anchor);
    $stop = strtotime('+1 month', $start); $count = 0;
    for ($d = $anchor; $d <= $stop; $d = strtotime('+'.$frequency.' '.$unit, $d)) {
        if (date('Y-m', $d) === $month) $count++;
    }
    $out[] = ['cycle'=>$cycle,'frequency'=>$frequency,'next_payment'=>$next,'month'=>$month,'occurrences'=>$count];
}
echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)."\n";
