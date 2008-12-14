#!/usr/bin/perl

use strict;

open(VERSION, "../version");
my $version = <VERSION>;
$version =~ s/[^\w\.]//gs;
close(VERSION);

# Pad the version with zeroes to get version comparisons
# right (1.2+ > 1.2.1 but 1.2.0+ < 1.2.1)
$version .= ".0" while ($version =~ tr/././ < 2);

my ($sec, $min, $hour, $day, $mon, $year) = localtime;
my $build = sprintf("%04i%02i%02i%02i", $year+1900, $mon+1, $day, $hour);
my $locale = (@ARGV ? join("-", '', @ARGV) : "");

@ARGV = qw(en-US de-DE ru-RU fr-FR es-ES it-IT pl-PL) unless @ARGV;

system("$^X build.pl adblockplus-kmeleon-$version+.$build$locale.zip +.$build @ARGV");

