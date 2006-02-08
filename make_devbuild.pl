#!/usr/bin/perl

use strict;

open(VERSION, "version");
my $version = <VERSION>;
$version =~ s/[^\w\.]//gs;
close(VERSION);

my $locale = (@ARGV ? "-" . join("-", @ARGV) : "");
@ARGV = ("adblockplus-$version+$locale.xpi", "-dev", @ARGV);
do 'create_xpi.pl';
