#!/usr/bin/perl

# This script runs jsrun.pl script in jsdoc-toolkit repository to generate
# source code documentation. Perl module JavaScript has to be installed.

die "Usage: $^X $0 output-directory\n" unless @ARGV;
my $target = $ARGV[0];

$0 =~ s/(.*[\\\/])//g;
chdir($1) if $1;

system("hg", "clone", "https://hg.adblockplus.org/jsdoc-toolkit/") unless -e "jsdoc-toolkit";

@ARGV = ('-t=jsdoc-toolkit/templates/jsdoc/',
         '-d=' . $target,
         '-a',
         '-p',
         '-x=js,jsm',
         'lib/');

$0 = "jsdoc-toolkit/jsrun.pl";
do $0;
die $@ if $@;
