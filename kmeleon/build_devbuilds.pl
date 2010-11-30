#!/usr/bin/perl

use strict;

my @locales = qw(en-US de ru fr es it pl);
foreach my $locale (@locales) {
  system($^X, "build_devbuild.pl", $locale);
}

system($^X, "build_devbuild.pl");
