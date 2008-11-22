#!/usr/bin/perl

use strict;

open(VERSION, "../version");
my $version = <VERSION>;
$version =~ s/[^\w\.]//gs;
close(VERSION);

my @locales = qw(en-US de-DE ru-RU fr-FR es-ES it-IT pl-PL);
foreach my $locale (@locales) {
  system("$^X build.pl adblockplus-kmeleon-$version-$locale.zip $locale");
}

system("$^X build.pl adblockplus-kmeleon-$version.zip @locales");
