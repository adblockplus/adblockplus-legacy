#!/usr/bin/perl

use strict;

open(VERSION, "../version");
my $version = <VERSION>;
$version =~ s/[^\w\.]//gs;
close(VERSION);

foreach my $locale (qw(en-US de-DE ru-RU fr-FR es-ES)) {
  system("$^X build.pl adblockplus-kmeleon-$version-$locale.zip $locale");
}

