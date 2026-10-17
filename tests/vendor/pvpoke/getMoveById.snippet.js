		object.getMoveById = function(id){
			if(id == "none")
				return;

			var m = object.moveMap.get(id);

			if(m !== undefined){

				// Generate move abbreviation

				var arr = m.moveId.split('_');
				var abbreviation = '';

				if(m.abbreviation){
					// Use predefined abbreviation if set
					abbreviation = m.abbreviation;
				} else{
					// Make abbreviation from first character of each word
					for(var i = 0; i < arr.length; i++){
						abbreviation += arr[i].charAt(0);
					}
				}

				var archetype = '';

				if(m.archetype){
					archetype = m.archetype;
				}

				move = {
					moveId: m.moveId,
					name: m.name,
					category: m.energyGain > 0 ? "fast" : "charged",
					displayName: m.name,
					abbreviation: abbreviation,
					archetype: archetype,
					type: m.type,
					power: m.power,
					energy: m.energy,
					energyGain: m.energyGain,
					damageMethod: "default",
					cooldown: m.cooldown,
					turns: m.turns,
					selfDebuffing: false,
					selfBuffing: false,
					selfAttackDebuffing: false,
					selfDefenseDebuffing: false,
					legacy: false,
					elite: false,
					instant: false,
					isMegaMove: false,
					tags: [],
					hasTag: function(tag){
						return this.tags.includes(tag);
					}
				};

				if(m?.category){
					move.category = m.category;
				}

				if((move.moveId == "RETURN")||(move.moveId == "FRUSTRATION")){
					move.legacy = true;
					move.displayName = move.displayName + "<sup>†</sup>";
				}
				

				if(m?.damageMethod){
					move.damageMethod = m.damageMethod;
				}

				if(m.buffs){
					move.buffs = m.buffs;
					move.buffApplyChance = parseFloat(m.buffApplyChance);
					move.buffTarget = m.buffTarget;

					if(move.buffTarget == "both"){
						move.buffsSelf = m.buffsSelf;
						move.buffsOpponent = m.buffsOpponent;
					}

					if( move.buffTarget == "self" && move.buffApplyChance >= .5 && move.moveId != "DRAGON_ASCENT" && (move.buffs[0] < 0 || move.buffs[1] < 0 )){
						move.selfDebuffing = true;

						// Mark if move debuffs attack
						if(move.buffs[0] < 0){
							move.selfAttackDebuffing = true;
						}

						// Mark if move debuffs defense
						if(move.buffs[1] < 0){
							move.selfDefenseDebuffing = true;
						}
					}

					if(move.buffApplyChance == 1 && (move.buffTarget == "opponent" || (move.buffTarget == "self" && (move.buffs[0] > 0 || move.buffs[1] > 0) || (move.buffTarget == "both" && (move.buffsSelf[0] > 0 || move.buffsSelf[1] > 0) )))){
						move.selfBuffing = true;
					}
				}

				if(m.formChange){
					move.formChange = JSON.parse(JSON.stringify(m.formChange));
				}

				if(m.tags){
					move.tags = [...m.tags];
				}

				if(m.isMegaMove){
					move.isMegaMove = m.isMegaMove;
				}
			} else{
				console.error(id + " missing");
			}

			return move;
		}

