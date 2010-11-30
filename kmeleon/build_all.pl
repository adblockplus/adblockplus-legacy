#!/usr/bin/perl

use strict;
use lib qw(../buildtools);
use Packager;

my $pkg = Packager->new();
$pkg->readMetadata('../metadata');
my $version = $pkg->{version};

my @locales = qw(en-US de ru fr es it pl);
foreach my $locale (@locales) {
  system($^X, "build.pl", "adblockplus-kmeleon-$version-$locale.zip", $locale);
}

system($^X, "build.pl", "adblockplus-kmeleon-$version.zip", @locales);
