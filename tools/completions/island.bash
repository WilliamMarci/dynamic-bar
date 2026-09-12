_island_complete() {
    local cur prev command index
    COMPREPLY=()
    cur=${COMP_WORDS[COMP_CWORD]}
    prev=${COMP_WORDS[COMP_CWORD-1]}

    if [[ $prev == -t || $prev == --title ]]; then
        return 0
    fi

    command=${COMP_WORDS[1]}
    if (( COMP_CWORD == 1 )); then
        COMPREPLY=( $(compgen -W 'run timer help list inspect demo start update done fail dismiss -h --help -t --title' -- "$cur")
            $(compgen -c -- "$cur") )
        return 0
    fi

    case $command in
        timer)
            if (( COMP_CWORD == 2 )); then
                COMPREPLY=( $(compgen -W '10s 30s 1m 5m 25m 1h' -- "$cur") )
            else
                COMPREPLY=( $(compgen -W '-t --title' -- "$cur") )
            fi
            ;;
        demo)
            COMPREPLY=( $(compgen -W 'progress' -- "$cur") )
            ;;
        run)
            index=2
            if [[ ${COMP_WORDS[index]} == -t || ${COMP_WORDS[index]} == --title ]]; then
                ((index+=2))
            fi
            if (( COMP_CWORD == index )); then
                COMPREPLY=( $(compgen -c -- "$cur") )
            else
                _filedir
            fi
            ;;
        -t|--title)
            if (( COMP_CWORD == 3 )); then
                return 0
            elif (( COMP_CWORD == 4 )); then
                COMPREPLY=( $(compgen -c -- "$cur") )
            else
                _filedir
            fi
            ;;
        help|list|inspect)
            ;;
        *)
            _filedir
            ;;
    esac
}
complete -F _island_complete island
