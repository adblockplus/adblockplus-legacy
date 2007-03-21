#!/usr/bin/perl

use strict;

open(VERSION, "../version");
my $version = <VERSION>;
$version =~ s/[^\w\.]//gs;
close(VERSION);

my ($sec, $min, $hour, $day, $mon, $year) = localtime;
my $build = sprintf("%04i%02i%02i%02i", $year+1900, $mon+1, $day, $hour);
my $locale = join("-", @ARGV);

system("$^X build.pl adblockplus-kmeleon-$version+.$build-$locale.zip +.$build @ARGV");

