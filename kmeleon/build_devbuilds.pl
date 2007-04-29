#!/usr/bin/perl

use strict;

my @locales = qw(en-US de-DE ru-RU fr-FR es-ES);
foreach my $locale (@locales) {
  system("$^X build_devbuild.pl $locale");
}

system("$^X build_devbuild.pl @locales");
