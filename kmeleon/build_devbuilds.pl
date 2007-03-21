#!/usr/bin/perl

use strict;

foreach my $locale (qw(en-US de-DE ru-RU fr-FR es-ES)) {
  system("$^X build_devbuild.pl $locale");
}

