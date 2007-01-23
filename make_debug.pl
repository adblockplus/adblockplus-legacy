#!/usr/bin/perl

use strict;

open(VERSION, "version");
my $version = <VERSION>;
$version =~ s/[^\w\.]//gs;
close(VERSION);

my ($sec, $min, $hour, $day, $mon, $year) = localtime;
my $build = sprintf("%04i%02i%02i%02i", $year+1900, $mon+1, $day, $hour);

my $locale = (@ARGV ? "-" . join("-", @ARGV) : "");
@ARGV = ("adblockplus-$version+.${build}debug$locale.xpi", "+.${build}debug", @ARGV);
do './create_xpi.pl';
