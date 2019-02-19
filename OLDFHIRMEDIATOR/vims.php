<?php
  $distribution = file_get_contents("/tmp/distribution.json");
  $ch = curl_init();
  curl_setopt($ch, CURLOPT_POST, true);
  curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
  curl_setopt($ch, CURLOPT_HEADER, false);
  curl_setopt($ch, CURLOPT_VERBOSE, true);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_HTTPHEADER, Array("Content-Type: application/json"));
  curl_setopt($ch, CURLOPT_COOKIEFILE, "cookies.txt");
  curl_setopt($ch,CURLOPT_POSTFIELDS,$distribution);
  $url = "https://vims.moh.go.tz/vaccine/inventory/distribution/save.json";
  curl_setopt($ch, CURLOPT_URL,$url);
  $output = curl_exec ($ch);
  $output = json_decode($output,JSON_PRETTY_PRINT);
  print_r($output)
?>
